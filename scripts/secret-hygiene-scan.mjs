#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  lstatSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PLACEHOLDER_VALUES = new Set([
  '',
  '...',
  'xxx',
  'xxxx',
  '<seed-admin-email>',
  '<seed-admin-password>',
  '<model-api-key>',
  '<redacted-model-api-key>',
  '<redacted>',
  'redacted',
  'placeholder',
  '<placeholder>',
  'change-me',
  '<change-me>',
  'refresh-token',
  'new-refresh-token',
  'old-refresh-token',
  'bad-refresh-token',
  'first-refresh-token',
  'second-refresh-token',
  'nested-refresh-token',
  'must-not-be-signed',
]);

const RESERVED_AUTH_PATHS = [
  /^cherry-auth\.json$/,
  /^[^/]+-auth\.json$/,
  /^auth-state\.json$/,
  /^storage-state\.json$/,
  /^playwright\/\.auth\/[^/]+\.json$/,
];

const MAX_TEXT_SCAN_BYTES = 5 * 1024 * 1024;

const LARGE_BINARY_LIKE_EXTENSIONS = new Set([
  '.7z',
  '.avif',
  '.br',
  '.db',
  '.gif',
  '.gz',
  '.ico',
  '.jpeg',
  '.jpg',
  '.mov',
  '.mp4',
  '.otf',
  '.pdf',
  '.png',
  '.sqlite',
  '.ttf',
  '.wasm',
  '.webp',
  '.woff',
  '.woff2',
  '.zip',
]);

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function gitBytes(args, cwd) {
  return execFileSync('git', args, { cwd });
}

function repoRoot() {
  return git(['rev-parse', '--show-toplevel'], process.cwd()).trim();
}

function listCommitCapableFiles(root) {
  const output = git(['ls-files', '-z', '--cached', '--others', '--exclude-standard'], root);
  return output.split('\0').filter(Boolean).sort();
}

function isPlaceholder(value) {
  const normalized = String(value).trim().toLowerCase();
  return (
    PLACEHOLDER_VALUES.has(normalized) ||
    /^\$\{[A-Z0-9_]+(?::\?[^}]*)?}$/.test(String(value).trim())
  );
}

function hasReusableValue(value) {
  if (typeof value !== 'string') {
    return false;
  }
  const trimmed = value.trim();
  const looksTokenLike =
    (trimmed.length >= 24 && /[A-Za-z]/.test(trimmed) && /[0-9]/.test(trimmed)) ||
    /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(trimmed) ||
    (/^[A-Za-z0-9+/=_-]{24,}$/.test(trimmed) && /[0-9]/.test(trimmed));
  return looksTokenLike && !isPlaceholder(trimmed);
}

function hasConcreteManualCredential(value) {
  if (typeof value !== 'string') {
    return false;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && !isPlaceholder(trimmed);
}

function hasExplicitSecretValue(value) {
  return typeof value === 'string' && value.trim().length > 0 && !isPlaceholder(value);
}

function hasKnownManualCredentialLiteral(value) {
  if (!hasConcreteManualCredential(value)) {
    return false;
  }
  return /^(?:changeme123!|concrete123!)$/i.test(value.trim());
}

function hasManualFillCredentialShape(value) {
  if (!hasConcreteManualCredential(value)) {
    return false;
  }
  const trimmed = value.trim();
  return (
    hasKnownManualCredentialLiteral(trimmed) ||
    (trimmed.length >= 8 &&
      /[A-Z]/.test(trimmed) &&
      /[a-z]/.test(trimmed) &&
      /[0-9]/.test(trimmed) &&
      /[^A-Za-z0-9]/.test(trimmed))
  );
}

function lineForNeedle(content, needle) {
  if (!needle) {
    return 1;
  }
  const index = content.indexOf(needle);
  if (index < 0) {
    return 1;
  }
  return content.slice(0, index).split('\n').length;
}

function addFinding(findings, file, line, rule, message) {
  findings.push({ file, line, rule, message });
}

function addManualCredentialFinding(findings, file, line) {
  addFinding(
    findings,
    file,
    line,
    'manual-credential-placeholder-misuse',
    'Manual test credential must use a placeholder value.',
  );
}

function scanJsonValue(value, ctx) {
  if (Array.isArray(value)) {
    value.forEach((entry) => scanJsonValue(entry, ctx));
    return;
  }

  if (!value || typeof value !== 'object') {
    return;
  }

  const keys = Object.keys(value);
  if (Array.isArray(value.cookies) && value.cookies.length > 0) {
    addFinding(
      ctx.findings,
      ctx.file,
      lineForNeedle(ctx.content, '"cookies"'),
      'browser-auth-state-json',
      'Browser storage-state JSON contains cookies.',
    );
  }

  if (Array.isArray(value.origins)) {
    for (const origin of value.origins) {
      if (Array.isArray(origin?.localStorage) && origin.localStorage.length > 0) {
        addFinding(
          ctx.findings,
          ctx.file,
          lineForNeedle(ctx.content, '"localStorage"'),
          'browser-auth-state-json',
          'Browser storage-state JSON contains local storage entries.',
        );
        break;
      }
    }
  }

  for (const key of keys) {
    const child = value[key];
    const lowerKey = key.toLowerCase();

    if (lowerKey === 'refresh_token' && hasExplicitSecretValue(child)) {
      addFinding(
        ctx.findings,
        ctx.file,
        lineForNeedle(ctx.content, key),
        'refresh-token-material',
        'Reusable refresh token material is present.',
      );
    }

    if (
      typeof value.name === 'string' &&
      value.name.toLowerCase() === 'refresh_token' &&
      key.toLowerCase() === 'value' &&
      hasExplicitSecretValue(child)
    ) {
      addFinding(
        ctx.findings,
        ctx.file,
        lineForNeedle(ctx.content, 'refresh_token'),
        'refresh-token-material',
        'Reusable refresh-token cookie material is present.',
      );
    }

    if (
      typeof value.name === 'string' &&
      /(?:token|session|auth)/i.test(value.name) &&
      lowerKey === 'value' &&
      hasReusableValue(child)
    ) {
      addFinding(
        ctx.findings,
        ctx.file,
        lineForNeedle(ctx.content, value.name),
        'browser-storage-credential',
        'Browser storage credential material is present.',
      );
    }

    scanJsonValue(child, ctx);
  }
}

function scanText(content, file, findings) {
  const lines = content.split(/\r?\n/);
  const manualCredentialFile = file.startsWith('tests/manual/') || file === 'test-checklist.csv';

  lines.forEach((line, index) => {
    const refreshMatch = line.match(
      /(?:^|[^\w])["']?refresh_token["']?\s*[=:]\s*["']?([^"'\s;,`)]+)/i,
    );
    if (refreshMatch && hasExplicitSecretValue(refreshMatch[1])) {
      addFinding(
        findings,
        file,
        index + 1,
        'refresh-token-material',
        'Reusable refresh token material is present.',
      );
    }

    if (!manualCredentialFile) {
      return;
    }

    const passwordMatch = line.match(/"\bpassword\b"\s*:\s*"([^"]+)"/i);
    if (passwordMatch && hasConcreteManualCredential(passwordMatch[1])) {
      addManualCredentialFinding(findings, file, index + 1);
    }

    const assignmentMatch = line.match(
      /\b(?:password|passwd|pwd|api[_-]?key|secret)\b\s*[:=]\s*["']?([^"'\s#`,;]+)/i,
    );
    if (assignmentMatch && hasConcreteManualCredential(assignmentMatch[1])) {
      addManualCredentialFinding(findings, file, index + 1);
    }

    const fillMatch = line.match(/\bagent-browser\s+fill\b.*?["']([^"']+)["']/i);
    if (fillMatch && hasManualFillCredentialShape(fillMatch[1])) {
      addManualCredentialFinding(findings, file, index + 1);
    }

    if (/\bsk-[A-Za-z0-9][A-Za-z0-9_-]{6,}\b/.test(line)) {
      addFinding(
        findings,
        file,
        index + 1,
        'manual-api-key-material',
        'Manual test document contains API-key-like material.',
      );
    }

    const shorthandMatch = line.match(/(?:测试环境|填写).*?\badmin\b\s*\/\s*`?([^`|\s]+)`?/i);
    if (shorthandMatch && hasConcreteManualCredential(shorthandMatch[1])) {
      addManualCredentialFinding(findings, file, index + 1);
    }
  });
}

function isText(buffer) {
  return !buffer.includes(0);
}

function isLargeBinaryLikePath(file) {
  return LARGE_BINARY_LIKE_EXTENSIONS.has(path.extname(file).toLowerCase());
}

function scanContentBuffer(rawContent, normalized, findings) {
  if (!isText(rawContent)) {
    return;
  }
  const content = rawContent.toString('utf8');

  if (normalized.endsWith('.json')) {
    try {
      scanJsonValue(JSON.parse(content), { content, file: normalized, findings });
    } catch {
      // Non-JSON content in a .json path is left to normal project validation.
    }
  }

  scanText(content, normalized, findings);
}

function addPathFinding(findings, normalized) {
  if (RESERVED_AUTH_PATHS.some((pattern) => pattern.test(normalized))) {
    addFinding(
      findings,
      normalized,
      1,
      'reserved-auth-artifact-path',
      'Local auth-state artifact path is commit-capable; it must be ignored or removed from staging.',
    );
  }
}

function dedupeFindings(findings) {
  const seen = new Set();
  return findings.filter((finding) => {
    const key = `${finding.file}\0${finding.line}\0${finding.rule}\0${finding.message}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function scanFiles(files, root = process.cwd()) {
  const findings = [];

  for (const file of files) {
    const normalized = file.split(path.sep).join('/');

    addPathFinding(findings, normalized);

    const fullPath = path.join(root, file);
    if (!existsSync(fullPath)) {
      continue;
    }
    const stat = lstatSync(fullPath);
    if (stat.isSymbolicLink()) {
      scanContentBuffer(Buffer.from(readlinkSync(fullPath)), normalized, findings);
      continue;
    }

    if (!stat.isFile()) {
      continue;
    }

    if (stat.size > MAX_TEXT_SCAN_BYTES) {
      if (!isLargeBinaryLikePath(normalized)) {
        addFinding(
          findings,
          normalized,
          1,
          'large-file-not-scanned',
          'Large commit-capable text-like file exceeds the secret scan size limit.',
        );
      }
      continue;
    }

    const rawContent = readFileSync(fullPath);
    scanContentBuffer(rawContent, normalized, findings);
  }

  return findings;
}

function listIndexEntries(root) {
  const output = git(['ls-files', '-s', '-z', '--cached'], root);
  return output
    .split('\0')
    .filter(Boolean)
    .map((entry) => {
      const tabIndex = entry.indexOf('\t');
      if (tabIndex < 0) {
        return null;
      }
      const metadata = entry.slice(0, tabIndex).split(' ');
      const mode = metadata[0];
      const file = entry.slice(tabIndex + 1);
      const objectName = metadata[1];
      if (!objectName || !file || mode === '160000') {
        return null;
      }
      return { file, objectName };
    })
    .filter(Boolean);
}

export function scanIndexBlobs(root = process.cwd()) {
  const findings = [];

  for (const entry of listIndexEntries(root)) {
    const normalized = entry.file.split(path.sep).join('/');
    addPathFinding(findings, normalized);

    const size = Number(git(['cat-file', '-s', entry.objectName], root).trim());
    if (!Number.isFinite(size)) {
      continue;
    }

    if (size > MAX_TEXT_SCAN_BYTES) {
      if (!isLargeBinaryLikePath(normalized)) {
        addFinding(
          findings,
          normalized,
          1,
          'large-file-not-scanned',
          'Large commit-capable text-like file exceeds the secret scan size limit.',
        );
      }
      continue;
    }

    const rawContent = gitBytes(['cat-file', 'blob', entry.objectName], root);
    scanContentBuffer(rawContent, normalized, findings);
  }

  return findings;
}

export function scanRepository(root = process.cwd()) {
  const files = listCommitCapableFiles(root);
  return { files, findings: dedupeFindings([...scanFiles(files, root), ...scanIndexBlobs(root)]) };
}

function refreshTokenJsonEvidence(value, prefix = '') {
  return `${prefix}{"refresh_${'token'}":"${value}"}`;
}

function runSelfTest() {
  const samples = [
    {
      name: 'detects browser cookies',
      files: [
        {
          path: 'sample.json',
          content: '{"cookies":[{"name":"sid","value":"abcdefghi"}],"origins":[]}',
        },
      ],
      wantFindings: true,
    },
    {
      name: 'allows placeholder manual credentials',
      files: [
        {
          path: 'tests/manual/check.md',
          content: '-d \'{"email":"<seed-admin-email>","password":"<seed-admin-password>"}\'',
        },
      ],
      wantFindings: false,
    },
    {
      name: 'detects concrete manual password',
      files: [
        {
          path: 'tests/manual/check.md',
          content: '-d \'{"email":"admin@example.test","password":"Concrete123!"}\'',
        },
      ],
      wantFindings: true,
    },
    {
      name: 'detects all-letter opaque refresh token',
      files: [
        {
          path: 'sample.json',
          content: refreshTokenJsonEvidence('abcdefghijklmnopqrstuvwxzyabcdefghijkl'),
        },
      ],
      wantFindings: true,
    },
    {
      name: 'detects quoted refresh token in markdown text',
      files: [
        {
          path: 'tests/manual/check.md',
          content: refreshTokenJsonEvidence(
            'abcdefghijklmnopqrstuvwxzyabcdefghijkl',
            'Manual evidence: ',
          ),
        },
      ],
      wantFindings: true,
    },
    {
      name: 'allows placeholder quoted refresh token in markdown text',
      files: [
        {
          path: 'tests/manual/check.md',
          content: refreshTokenJsonEvidence('refresh-token', 'Manual evidence: '),
        },
      ],
      wantFindings: false,
    },
    {
      name: 'detects manual fill credential',
      files: [
        {
          path: 'tests/manual/check.md',
          content: 'agent-browser fill @eXX "ChangeMe123!"',
        },
      ],
      wantFindings: true,
    },
    {
      name: 'detects manual password assignment',
      files: [
        {
          path: 'tests/manual/check.md',
          content: 'password=Concrete123!',
        },
      ],
      wantFindings: true,
    },
    {
      name: 'detects manual API-key prefix',
      files: [
        {
          path: 'tests/manual/check.md',
          content: 'MODEL_API_KEY=sk-abcdefghijklmnopqrstuvwxyz',
        },
      ],
      wantFindings: true,
    },
    {
      name: 'detects reserved auth path',
      files: [{ path: 'local-auth.json', content: '{}' }],
      wantFindings: true,
    },
    {
      name: 'detects oversized text-like file',
      files: [
        {
          path: 'large.txt',
          content: 'x'.repeat(MAX_TEXT_SCAN_BYTES + 1),
        },
      ],
      useScanFiles: true,
      wantFindings: true,
    },
    {
      name: 'does not follow working-tree symlink target content',
      files: [
        {
          path: 'tests/manual/symlink.md',
          targetContent: 'password=Concrete123!',
        },
      ],
      useScanFiles: true,
      useSymlink: true,
      wantFindings: false,
    },
    {
      name: 'detects staged quoted refresh token when working tree has placeholder',
      useGitIndex: true,
      stagedContent: `${refreshTokenJsonEvidence(
        'abcdefghijklmnopqrstuvwxzyabcdefghijkl',
        'Manual evidence: ',
      )}\n`,
      worktreeContent: `${refreshTokenJsonEvidence('refresh-token', 'Manual evidence: ')}\n`,
      wantFindings: true,
    },
  ];

  let failures = 0;
  for (const sample of samples) {
    const findings = [];
    let tmpRoot;
    let outsideRoot;
    try {
      if (sample.useGitIndex) {
        tmpRoot = mkdtempSync(path.join(tmpdir(), 'secret-hygiene-self-test-'));
        git(['init', '-q'], tmpRoot);
        const manualPath = 'tests/manual/check.md';
        const fullPath = path.join(tmpRoot, manualPath);
        mkdirSync(path.dirname(fullPath), { recursive: true });
        writeFileSync(fullPath, sample.stagedContent ?? 'password=Concrete123!\n');
        git(['add', manualPath], tmpRoot);
        writeFileSync(fullPath, sample.worktreeContent ?? 'password=<seed-admin-password>\n');

        const files = listCommitCapableFiles(tmpRoot);
        const worktreeFindings = scanFiles(files, tmpRoot);
        if (worktreeFindings.length > 0) {
          throw new Error('working-tree placeholder unexpectedly produced findings');
        }
        findings.push(...scanRepository(tmpRoot).findings);
      } else if (sample.useScanFiles) {
        tmpRoot = mkdtempSync(path.join(tmpdir(), 'secret-hygiene-self-test-'));
        for (const file of sample.files) {
          const fullPath = path.join(tmpRoot, file.path);
          mkdirSync(path.dirname(fullPath), { recursive: true });
          if (sample.useSymlink) {
            outsideRoot = mkdtempSync(path.join(tmpdir(), 'secret-hygiene-outside-'));
            const outsidePath = path.join(outsideRoot, 'outside.txt');
            writeFileSync(outsidePath, file.targetContent);
            symlinkSync(outsidePath, fullPath);
          } else {
            writeFileSync(fullPath, file.content);
          }
        }
        findings.push(
          ...scanFiles(
            sample.files.map((file) => file.path),
            tmpRoot,
          ),
        );
      } else {
        for (const file of sample.files) {
          if (RESERVED_AUTH_PATHS.some((pattern) => pattern.test(file.path))) {
            addFinding(
              findings,
              file.path,
              1,
              'reserved-auth-artifact-path',
              'Reserved path detected.',
            );
          }
          if (file.path.endsWith('.json')) {
            scanJsonValue(JSON.parse(file.content), {
              content: file.content,
              file: file.path,
              findings,
            });
          }
          scanText(file.content, file.path, findings);
        }
      }
    } finally {
      if (tmpRoot) {
        rmSync(tmpRoot, { recursive: true, force: true });
      }
      if (outsideRoot) {
        rmSync(outsideRoot, { recursive: true, force: true });
      }
    }

    const passed = sample.wantFindings ? findings.length > 0 : findings.length === 0;
    if (!passed) {
      failures += 1;
      console.error(`Self-test failed: ${sample.name}`);
    }
  }

  if (failures > 0) {
    process.exitCode = 1;
    return;
  }

  console.log(`Secret hygiene scan self-test passed: ${samples.length} cases.`);
}

function main() {
  if (process.argv.includes('--self-test')) {
    runSelfTest();
    return;
  }

  const root = repoRoot();
  const { files, findings } = scanRepository(root);

  if (findings.length > 0) {
    console.error(`Secret hygiene scan failed: ${findings.length} finding(s).`);
    for (const finding of findings) {
      console.error(`${finding.file}:${finding.line} [${finding.rule}] ${finding.message}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `Secret hygiene scan passed: scanned ${files.length} commit-capable file(s), 0 findings.`,
  );
}

const currentModulePath = fileURLToPath(import.meta.url);
const entrypointPath = process.argv[1] ? path.resolve(process.argv[1]) : '';

if (entrypointPath === currentModulePath) {
  main();
}
