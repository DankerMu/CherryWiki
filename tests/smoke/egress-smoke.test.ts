import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const rootDir = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('egress SSRF smoke', () => {
  it('blocks private and metadata IPs while allowing public IPs', () => {
    const script = String.raw`
import importlib.util
import json
import pathlib
import sys
import types

root = pathlib.Path("apps/url-fetcher-worker/src").resolve()
src_package = types.ModuleType("src")
src_package.__path__ = [str(root)]
sys.modules["src"] = src_package
ssrf_package = types.ModuleType("src.ssrf")
ssrf_package.__path__ = [str(root / "ssrf")]
sys.modules["src.ssrf"] = ssrf_package

errors_spec = importlib.util.spec_from_file_location("src.errors", root / "errors.py")
errors_module = importlib.util.module_from_spec(errors_spec)
sys.modules["src.errors"] = errors_module
errors_spec.loader.exec_module(errors_module)

validator_spec = importlib.util.spec_from_file_location(
    "src.ssrf.ip_validator",
    root / "ssrf" / "ip_validator.py",
)
validator_module = importlib.util.module_from_spec(validator_spec)
sys.modules["src.ssrf.ip_validator"] = validator_module
validator_spec.loader.exec_module(validator_module)

from src.errors import SsrfBlockedError

IpValidator = validator_module.IpValidator

validator = IpValidator()
blocked = {}
for ip in ("169.254.169.254", "10.0.0.1", "127.0.0.1"):
    try:
        validator.validate_ip(ip, target_url=f"http://{ip}/")
    except SsrfBlockedError as exc:
        blocked[ip] = exc.metadata["block_reason"]
    else:
        raise AssertionError(f"{ip} was allowed")

allowed = validator.validate_ip("8.8.8.8", target_url="http://8.8.8.8/")
print(json.dumps({"blocked": blocked, "allowed": allowed.ip}, sort_keys=True))
`;

    const result = spawnSync('python3', ['-c', script], {
      cwd: rootDir,
      env: {
        ...process.env,
        PYTHONPATH: path.join(rootDir, 'apps/url-fetcher-worker'),
      },
      encoding: 'utf8',
    });

    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      allowed: '8.8.8.8',
      blocked: {
        '10.0.0.1': 'private_ip_rfc1918',
        '127.0.0.1': 'private_ip_localhost',
        '169.254.169.254': 'link_local_metadata',
      },
    });
  });
});
