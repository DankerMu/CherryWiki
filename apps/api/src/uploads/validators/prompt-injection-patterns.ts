export type PromptInjectionCategory =
  | 'instruction_override'
  | 'system_prompt_exfiltration'
  | 'role_impersonation'
  | 'tool_abuse';

export type PromptInjectionPattern = {
  id: string;
  category: PromptInjectionCategory;
  pattern: RegExp;
};

export const PROMPT_INJECTION_PATTERNS: readonly PromptInjectionPattern[] = [
  {
    id: 'override.ignore_previous',
    category: 'instruction_override',
    pattern: /\bignore\s+(?:all\s+)?(?:previous|prior|above|earlier)\s+instructions?\b/i,
  },
  {
    id: 'override.disregard_previous',
    category: 'instruction_override',
    pattern: /\bdisregard\s+(?:all\s+)?(?:previous|prior|above|earlier)\s+instructions?\b/i,
  },
  {
    id: 'override.forget_rules',
    category: 'instruction_override',
    pattern: /\bforget\s+(?:all\s+)?(?:rules|instructions|guidelines|policies)\b/i,
  },
  {
    id: 'override.new_instructions',
    category: 'instruction_override',
    pattern: /\b(?:new|updated|replacement)\s+(?:system\s+)?instructions?\s*:/i,
  },
  {
    id: 'system.reveal_prompt',
    category: 'system_prompt_exfiltration',
    pattern: /\b(?:reveal|show|print|dump|display)\s+(?:the\s+)?(?:system|developer)\s+prompt\b/i,
  },
  {
    id: 'system.repeat_hidden',
    category: 'system_prompt_exfiltration',
    pattern: /\brepeat\s+(?:the\s+)?(?:hidden|secret|confidential)\s+(?:prompt|instructions?)\b/i,
  },
  {
    id: 'system.config_dump',
    category: 'system_prompt_exfiltration',
    pattern: /\b(?:dump|export|print)\s+(?:your\s+)?(?:configuration|policy|guardrails)\b/i,
  },
  {
    id: 'system.token_leak',
    category: 'system_prompt_exfiltration',
    pattern: /\b(?:show|print|reveal)\s+(?:api\s+keys?|tokens?|credentials|secrets?)\b/i,
  },
  {
    id: 'role.system_message',
    category: 'role_impersonation',
    pattern: /^\s*(?:system|developer|assistant)\s*:\s+/im,
  },
  {
    id: 'role.act_as_system',
    category: 'role_impersonation',
    pattern: /\bact\s+as\s+(?:the\s+)?(?:system|developer|administrator|root)\b/i,
  },
  {
    id: 'role.jailbreak_mode',
    category: 'role_impersonation',
    pattern: /\b(?:dan|jailbreak|developer\s+mode|god\s+mode)\b/i,
  },
  {
    id: 'role.priority_override',
    category: 'role_impersonation',
    pattern: /\b(?:highest|top)\s+priority\s+(?:instruction|directive|message)\b/i,
  },
  {
    id: 'tool.call_shell',
    category: 'tool_abuse',
    pattern: /\b(?:run|execute|call)\s+(?:a\s+)?(?:shell|terminal|bash|powershell)\s+(?:command|script)\b/i,
  },
  {
    id: 'tool.browse_secret',
    category: 'tool_abuse',
    pattern: /\b(?:open|read|download)\s+(?:\/etc\/passwd|\.env|ssh\s+keys?|private\s+keys?)\b/i,
  },
  {
    id: 'tool.exfiltrate_data',
    category: 'tool_abuse',
    pattern: /\b(?:send|post|upload|exfiltrate)\s+(?:data|files?|secrets?|credentials)\s+to\s+https?:\/\//i,
  },
  {
    id: 'tool.disable_safety',
    category: 'tool_abuse',
    pattern: /\b(?:disable|bypass|turn\s+off)\s+(?:safety|filters?|guardrails?|policy)\b/i,
  },
] as const;
