import { PROMPT_INJECTION_PATTERNS } from './prompt-injection-patterns.js';

export function checkInjectionRisk(content: string, sourceDocMetadata?: { injection_risk?: boolean }): boolean {
  if (sourceDocMetadata?.injection_risk === true) {
    return true;
  }

  return PROMPT_INJECTION_PATTERNS.some(({ pattern }) => pattern.test(content));
}
