import { Injectable } from '@nestjs/common';

export type ClaudeSettings = {
  env: Record<string, string>;
  model: string;
  tools: string[];
  skipDangerousModePermissionPrompt: boolean;
  permissions: {
    allow: string[];
    deny: string[];
  };
};

export type SettingsGeneratorInput = {
  anthropicApiKey?: string;
  anthropicBaseUrl?: string;
  anthropicModel?: string;
  model?: string;
};

const DEFAULT_MODEL = 'sonnet';
const ALLOWED_TOOLS = ['Bash', 'Read'] as const;

@Injectable()
export class SettingsGenerator {
  generate(input: SettingsGeneratorInput = {}): ClaudeSettings {
    const env: Record<string, string> = {};
    const apiKey = input.anthropicApiKey ?? process.env.AGENT_ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY;
    const baseUrl = input.anthropicBaseUrl ?? process.env.AGENT_ANTHROPIC_BASE_URL ?? process.env.ANTHROPIC_BASE_URL;
    const model = input.anthropicModel ?? input.model ?? process.env.AGENT_ANTHROPIC_MODEL ?? process.env.ANTHROPIC_MODEL;

    if (apiKey !== undefined && apiKey.length > 0) {
      env.ANTHROPIC_API_KEY = apiKey;
    }

    if (baseUrl !== undefined && baseUrl.length > 0) {
      env.ANTHROPIC_BASE_URL = baseUrl;
    }

    if (model !== undefined && model.length > 0) {
      env.ANTHROPIC_MODEL = model;
    }

    return {
      env,
      model: model ?? DEFAULT_MODEL,
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
