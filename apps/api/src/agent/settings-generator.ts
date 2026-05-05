import { Injectable } from '@nestjs/common';

export type ClaudeSettings = {
  tools: string[];
  skipDangerousModePermissionPrompt: boolean;
  permissions: {
    allow: string[];
    deny: string[];
  };
};

const ALLOWED_TOOLS = ['Bash', 'Read'] as const;

@Injectable()
export class SettingsGenerator {
  generate(): ClaudeSettings {
    return {
      tools: [...ALLOWED_TOOLS],
      skipDangerousModePermissionPrompt: true,
      permissions: {
        allow: [
          'Bash(cherrywiki *)',
          'Bash(graphify *)',
          'Bash(cherrydb *)',
          'Read(*)',
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
}
