import fs from 'node:fs';
import path from 'node:path';

export function initWikiRepo(basePath: string, spaceId: string): string {
  const spacePath = path.join(basePath, 'spaces', spaceId);
  const dirs = ['pages', 'communities', 'god-nodes', '_attachments', '_metadata'];

  for (const dir of dirs) {
    fs.mkdirSync(path.join(spacePath, dir), { recursive: true });
  }

  const jsonlPath = path.join(spacePath, '_metadata', 'pages.jsonl');
  if (!fs.existsSync(jsonlPath)) {
    fs.writeFileSync(jsonlPath, '', 'utf-8');
  }

  return spacePath;
}
