import { afterEach, describe, it, expect, vi } from 'vitest';
import StarterKit from '@tiptap/starter-kit';
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Highlight from '@tiptap/extension-highlight';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { common, createLowlight } from 'lowlight';
import { marked } from 'marked';
import { convertMarkdownToTiptapJSON } from '../lib/markdownToTiptap';

const lowlight = createLowlight(common);
const extensions = [
  StarterKit.configure({ codeBlock: false, link: false }),
  CodeBlockLowlight.configure({ lowlight }),
  Table,
  TableRow,
  TableCell,
  TableHeader,
  TaskList,
  TaskItem,
  Link,
  Image,
  Highlight,
];

describe('convertMarkdownToTiptapJSON', () => {
  it('returns empty doc for empty string', () => {
    const result = convertMarkdownToTiptapJSON('', extensions);
    expect(result).toEqual({ type: 'doc', content: [] });
  });

  it('returns empty doc for whitespace-only string', () => {
    const result = convertMarkdownToTiptapJSON('   ', extensions);
    expect(result).toEqual({ type: 'doc', content: [] });
  });

  it('converts heading and paragraph', () => {
    const result = convertMarkdownToTiptapJSON('# Hello\n\nWorld', extensions);
    expect(result?.type).toBe('doc');
    expect(result?.content?.some((n) => n.type === 'heading')).toBe(true);
    expect(result?.content?.some((n) => n.type === 'paragraph')).toBe(true);
  });

  it('converts fenced code block with language', () => {
    const md = '```python\nprint("hi")\n```';
    const result = convertMarkdownToTiptapJSON(md, extensions);
    const codeBlock = result?.content?.find((n) => n.type === 'codeBlock');
    expect(codeBlock).toBeDefined();
    expect(codeBlock?.attrs?.language).toBe('python');
  });

  it('converts GFM table', () => {
    const md = '| A | B |\n|---|---|\n| 1 | 2 |';
    const result = convertMarkdownToTiptapJSON(md, extensions);
    expect(result?.content?.some((n) => n.type === 'table')).toBe(true);
  });

  it('converts nested list', () => {
    const md = '- a\n  - b\n    - c';
    const result = convertMarkdownToTiptapJSON(md, extensions);
    expect(result?.content?.some((n) => n.type === 'bulletList')).toBe(true);
  });

  it('converts task list with checked and unchecked items', () => {
    const md = '- [x] Done\n- [ ] Todo';
    const result = convertMarkdownToTiptapJSON(md, extensions);
    expect(result?.content?.some((n) => n.type === 'taskList')).toBe(true);
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it('returns null for malformed input that causes parse error', () => {
    vi.spyOn(marked, 'parse').mockImplementation(() => { throw new Error('simulated parse error'); });
    const result = convertMarkdownToTiptapJSON('# test', extensions);
    expect(result).toBeNull();
  });
});
