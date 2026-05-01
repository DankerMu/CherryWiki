import { Injectable } from '@nestjs/common';

import { PROMPT_INJECTION_PATTERNS } from './prompt-injection-patterns.js';

export type PromptInjectionScanResult = {
  injection_risk: boolean;
  matched_patterns: string[];
};

@Injectable()
export class PromptInjectionScanner {
  scan(content: string): PromptInjectionScanResult {
    const matchedPatterns = new Set<string>();

    for (const item of PROMPT_INJECTION_PATTERNS) {
      item.pattern.lastIndex = 0;
      if (item.pattern.test(content)) {
        matchedPatterns.add(item.id);
      }
    }

    return {
      injection_risk: matchedPatterns.size > 0,
      matched_patterns: [...matchedPatterns],
    };
  }

  applyToMetadata(metadata: Record<string, unknown>, result: PromptInjectionScanResult): Record<string, unknown> {
    return {
      ...metadata,
      injection_risk: result.injection_risk,
      injection_patterns: result.matched_patterns,
    };
  }
}
