const graphifyCommentPlaceholder = '__GRAPHIFY_COMMENT_PLACEHOLDER__';
const allowedImageDomains = new Set(['assets.cherrygraph.local']);
const dangerousOpenTagPattern = /<(script|iframe|object|embed)\b[^>]{0,2048}>/gi;
const maxDangerousBlockContentLength = 10000;
const maxClosingTagLength = 128;

export function sanitizeMarkdown(content: string): string {
  let result = stripDangerousHtmlBlocks(content);
  result = result.replace(/<(script|iframe|object|embed)\b[^>]{0,2048}\/?>/gi, '');

  const graphifyComments: string[] = [];
  result = result.replace(/<!--\s*graphify:[\s\S]{0,10000}?-->/gi, match => {
    const index = graphifyComments.push(match) - 1;
    return `${graphifyCommentPlaceholder}${index}__`;
  });

  result = result.replace(/\s+on[a-z][\w:-]{0,63}\s*=\s*(?:"[^"\r\n]{0,2048}"|'[^'\r\n]{0,2048}'|[^\s>"']{1,2048})/gi, '');
  result = result.replace(
    /\s+(?:src|href)\s*=\s*(?:"\s*data:[^"\r\n]{0,4096}"|'\s*data:[^'\r\n]{0,4096}'|\s*data:[^\s>]{0,4096})/gi,
    '',
  );
  result = result.replace(
    /\s+(?:src|href)\s*=\s*(?:"\s*javascript:[^"\r\n]{0,4096}"|'\s*javascript:[^'\r\n]{0,4096}'|\s*javascript:[^\s>]{0,4096})/gi,
    '',
  );
  result = result.replace(/<!--[\s\S]{0,10000}?-->/g, '');
  result = result.replace(/<\/?[A-Za-z][A-Za-z0-9:-]*(?:\s+[^>]{0,2048})?\s*\/?>/g, '');

  result = sanitizeMarkdownUris(result);

  for (let index = 0; index < graphifyComments.length; index += 1) {
    result = result.replace(`${graphifyCommentPlaceholder}${index}__`, graphifyComments[index] ?? '');
  }

  return result;
}

function stripDangerousHtmlBlocks(content: string): string {
  let result = '';
  let cursor = 0;
  dangerousOpenTagPattern.lastIndex = 0;

  for (let match = dangerousOpenTagPattern.exec(content); match; match = dangerousOpenTagPattern.exec(content)) {
    const tagName = (match[1] ?? '').toLowerCase();
    const openStart = match.index;
    const openEnd = dangerousOpenTagPattern.lastIndex;
    const closeEnd = findDangerousClosingTagEnd(content, tagName, openEnd);

    result += content.slice(cursor, openStart);
    if (closeEnd === -1) {
      cursor = openEnd;
    } else {
      cursor = closeEnd;
      dangerousOpenTagPattern.lastIndex = closeEnd;
    }
  }

  return result + content.slice(cursor);
}

function findDangerousClosingTagEnd(content: string, tagName: string, fromIndex: number): number {
  const searchEnd = Math.min(
    content.length,
    fromIndex + maxDangerousBlockContentLength + maxClosingTagLength,
  );
  const searchWindow = content.slice(fromIndex, searchEnd).toLowerCase();
  const closingTagStartInWindow = searchWindow.indexOf(`</${tagName}`);

  if (closingTagStartInWindow === -1 || closingTagStartInWindow > maxDangerousBlockContentLength) {
    return -1;
  }

  const closingTagStart = fromIndex + closingTagStartInWindow;
  const closingTagEnd = content.indexOf('>', closingTagStart);
  if (closingTagEnd === -1 || closingTagEnd - closingTagStart > maxClosingTagLength) {
    return -1;
  }

  return closingTagEnd + 1;
}

function sanitizeMarkdownUris(content: string): string {
  let result = content.replace(/!\[([^\]\r\n]{0,2048})\]\(\s*(?:data|javascript):[^\r\n]{0,4096}\)/gi, (_match, alt: string) => alt);

  result = result.replace(/\[([^\]\r\n]{1,2048})\]\(\s*(?:data|javascript):[^\r\n]{0,4096}\)/gi, (_match, text: string) => text);

  result = result.replace(/!\[([^\]\r\n]{0,2048})\]\(([^)\s\r\n]{1,2048})(?:\s+"[^"\r\n]{0,1024}")?\)/g, (match, alt: string, rawUrl: string) => {
    if (isAllowedImageUrl(rawUrl)) {
      return match;
    }

    return alt ? alt : '';
  });

  result = result.replace(/\[([^\]\r\n]{1,2048})\]\(([^)\s\r\n]{1,2048})(?:\s+"[^"\r\n]{0,1024}")?\)/g, (match, text: string, rawUrl: string) => {
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
