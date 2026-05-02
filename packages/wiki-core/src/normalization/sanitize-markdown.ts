const graphifyCommentPlaceholder = '__GRAPHIFY_COMMENT_PLACEHOLDER__';
const allowedImageDomains = new Set(['assets.cherrygraph.local']);

export function sanitizeMarkdown(content: string): string {
  let result = content.replace(/<(script|iframe|object|embed)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  result = result.replace(/<(script|iframe|object|embed)\b[^>]*\/?>/gi, '');

  const graphifyComments: string[] = [];
  result = result.replace(/<!--\s*graphify:[\s\S]*?-->/gi, match => {
    const index = graphifyComments.push(match) - 1;
    return `${graphifyCommentPlaceholder}${index}__`;
  });

  result = result.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  result = result.replace(/\s+(?:src|href)\s*=\s*(?:"data:[^"]*"|'data:[^']*'|data:[^\s>]+)/gi, '');
  result = result.replace(/\s+(?:src|href)\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*'|javascript:[^\s>]+)/gi, '');
  result = result.replace(/<!--[\s\S]*?-->/g, '');
  result = result.replace(/<(?!!--)[^>]+>/g, '');

  result = sanitizeMarkdownUris(result);

  for (let index = 0; index < graphifyComments.length; index += 1) {
    result = result.replace(`${graphifyCommentPlaceholder}${index}__`, graphifyComments[index] ?? '');
  }

  return result;
}

function sanitizeMarkdownUris(content: string): string {
  let result = content.replace(/!\[([^\]]*)\]\(\s*(?:data|javascript):[^\n]*\)/gi, (_match, alt: string) => alt);

  result = result.replace(/\[([^\]]+)\]\(\s*(?:data|javascript):[^\n]*\)/gi, (_match, text: string) => text);

  result = result.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (match, alt: string, rawUrl: string) => {
    if (isAllowedImageUrl(rawUrl)) {
      return match;
    }

    return alt ? alt : '';
  });

  result = result.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (match, text: string, rawUrl: string) => {
    if (isUnsafeUri(rawUrl)) {
      return text;
    }

    return match;
  });

  return result;
}

function isAllowedImageUrl(rawUrl: string): boolean {
  if (rawUrl.startsWith('_attachments/') || rawUrl.startsWith('./_attachments/')) {
    return true;
  }

  if (isUnsafeUri(rawUrl)) {
    return false;
  }

  try {
    const url = new URL(rawUrl);
    return (url.protocol === 'https:' || url.protocol === 'http:') && allowedImageDomains.has(url.hostname);
  } catch {
    return !/^[a-z][a-z0-9+.-]*:/i.test(rawUrl);
  }
}

function isUnsafeUri(rawUrl: string): boolean {
  const normalized = rawUrl.trim().toLowerCase();
  return normalized.startsWith('data:') || normalized.startsWith('javascript:');
}
