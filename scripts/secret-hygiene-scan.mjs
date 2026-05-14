#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const PLACEHOLDER_VALUES = new Set([
  '',
  '...',
  '<seed-admin-email>',
  '<seed-admin-password>',
  '<redacted>',
  'redacted',
  'placeholder',
  '<placeholder>',
  'change-me',
  '<change-me>',
]);

const RESERVED_AUTH_PATHS = [
  /^cherry-auth\.json$/,
  /^[^/]+-auth\.json$/,
  /^auth-state\.json$/,
  /^storage-state\.json$/,
  /^playwright\/\.auth\/[^/]+\.json$/,
];

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
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
    /^<[^>]+>$/.test(normalized) ||
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

    if (lowerKey === 'refresh_token' && hasReusableValue(child)) {
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
      hasReusableValue(child)
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
    const refreshMatch = line.match(/\brefresh_token\b\s*[=:]\s*["']?([^"'\s;,`)]+)/i);
    if (refreshMatch && hasReusableValue(refreshMatch[1])) {
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
      addFinding(
        findings,
        file,
        index + 1,
        'manual-credential-placeholder-misuse',
        'Manual test credential must use a placeholder value.',
      );
    }

    const shorthandMatch = line.match(/(?:测试环境|填写).*?\badmin\b\s*\/\s*`?([^`|\s]+)`?/i);
    if (shorthandMatch && hasConcreteManualCredential(shorthandMatch[1])) {
      addFinding(
        findings,
        file,
        index + 1,
        'manual-credential-placeholder-misuse',
        'Manual test credential must use a placeholder value.',
      );
    }
  });
}

function isText(content) {
  return !content.includes('\0');
}

export function scanFiles(files, root = process.cwd()) {
  const findings = [];

  for (const file of files) {
    const normalized = file.split(path.sep).join('/');

    if (RESERVED_AUTH_PATHS.some((pattern) => pattern.test(normalized))) {
      addFinding(
        findings,
        normalized,
        1,
        'reserved-auth-artifact-path',
        'Local auth-state artifact path is commit-capable; it must be ignored or removed from staging.',
      );
    }

    const fullPath = path.join(root, file);
    if (!existsSync(fullPath)) {
      continue;
    }
    if (!statSync(fullPath).isFile()) {
      continue;
    }

    const content = readFileSync(fullPath, 'utf8');
    if (!isText(content)) {
      continue;
    }

    if (normalized.endsWith('.json')) {
      try {
        scanJsonValue(JSON.parse(content), { content, file: normalized, findings });
      } catch {
        // Non-JSON content in a .json path is left to normal project validation.
      }
    }

    scanText(content, normalized, findings);
  }

  return findings;
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
      name: 'detects reserved auth path',
      files: [{ path: 'local-auth.json', content: '{}' }],
      wantFindings: true,
    },
  ];

  let failures = 0;
  for (const sample of samples) {
    const findings = [];
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
  const files = listCommitCapableFiles(root);
  const findings = scanFiles(files, root);

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

main();
