import type { Extensions, JSONContent } from '@tiptap/core';
import { generateJSON } from '@tiptap/html';
import { marked } from 'marked';

function postProcessTaskLists(html: string): string {
  return html.replace(/<ul>([\s\S]*?)<\/ul>/g, (match, listContent: string) => {
    if (!/<li>\s*<input\b[^>]*\btype="checkbox"/.test(listContent)) {
      return match;
    }

    const processedItems = listContent.replace(/<li>\s*<input\b([^>]*)>/g, (_itemMatch, inputAttrs: string) => {
      const checked = /\bchecked(?:=""|="checked"|)\b/.test(inputAttrs);
      return `<li data-type="taskItem" data-checked="${checked ? 'true' : 'false'}"><input${inputAttrs}>`;
    });

    return `<ul data-type="taskList">${processedItems}</ul>`;
  });
}

export function convertMarkdownToTiptapJSON(markdown: string, extensions: Extensions): JSONContent | null {
  if (markdown.trim().length === 0) {
    return { type: 'doc', content: [] };
  }

  try {
    const html = marked.parse(markdown, { gfm: true, breaks: false, async: false });
    const processed = postProcessTaskLists(html);
    return generateJSON(processed, extensions) as JSONContent;
  } catch {
    return null;
  }
}
