import { Injectable } from '@nestjs/common';

import { normalizeGraphReadPath, normalizeWorkDirReadPath } from './agent-graph-paths.js';

export type ClaudeSettings = {
  tools: string[];
  skipDangerousModePermissionPrompt: boolean;
  permissions: {
    allow: string[];
    deny: string[];
  };
};

export type GenerateOptions = {
  workDir: string;
  graphPaths: string[];
};

const ALLOWED_TOOLS = ['Bash', 'Read'] as const;

@Injectable()
export class SettingsGenerator {
  generate(options: GenerateOptions): ClaudeSettings {
    const readScopes = this.buildReadScopes(options);

    return {
      tools: [...ALLOWED_TOOLS],
      skipDangerousModePermissionPrompt: true,
      permissions: {
        allow: [
          'Bash(cherrywiki *)',
          'Bash(graphify *)',
          'Bash(cherrydb *)',
          ...readScopes,
        ],
        deny: [
          'Write',
          'Edit',
          'MultiEdit',
          'NotebookEdit',
          'WebFetch',
          'WebSearch',
          'Task',
          'Bash(rm *)',
          'Bash(curl *)',
          'Bash(wget *)',
          'Bash(chmod *)',
          'Bash(chown *)',
          'Bash(python *)',
          'Bash(node *)',
          'Bash(sh *)',
          'Bash(bash -c *)',
          'Bash(echo * > *)',
          'Bash(cat * > *)',
          'Bash(tee *)',
        ],
      },
    };
  }

  private buildReadScopes(options: GenerateOptions): string[] {
    const paths = new Set<string>();
    const workDir = normalizeWorkDirReadPath(options.workDir);

    if (workDir !== undefined) {
      paths.add(workDir);
    }

    for (const graphPath of options.graphPaths ?? []) {
      const validated = normalizeGraphReadPath(graphPath);
      if (validated !== undefined) {
        paths.add(validated);
      }
    }

    return [...paths].sort().map((path) => `Read(${path})`);
  }
}
