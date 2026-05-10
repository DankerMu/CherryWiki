import { useEditor, EditorContent } from '@tiptap/react';
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
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { useMemo } from 'react';
import { convertMarkdownToTiptapJSON } from '../lib/markdownToTiptap';
import './TiptapRenderer.css';

const lowlight = createLowlight(common);

const extensions = [
  StarterKit.configure({ codeBlock: false }),
  CodeBlockLowlight.configure({ lowlight }),
  Table.configure({ resizable: false }),
  TableRow,
  TableCell,
  TableHeader,
  TaskList,
  TaskItem.configure({ nested: true }),
  Link.configure({
    openOnClick: true,
    HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' },
  }),
  Image.configure({ inline: false }),
  Highlight,
];

type TiptapRendererProps = {
  markdown: string;
};

export default function TiptapRenderer({ markdown }: TiptapRendererProps) {
  const content = useMemo(() => {
    try {
      return convertMarkdownToTiptapJSON(markdown, extensions);
    } catch (err) {
      console.warn('TiptapRenderer: markdown conversion failed, using fallback', err);
      return null;
    }
  }, [markdown]);

  const editor = useEditor(
    {
      extensions,
      content: content ?? '',
      editable: false,
      immediatelyRender: false,
    },
    [content],
  );

  if (content === null) {
    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          img: (props) => <img {...props} referrerPolicy="no-referrer" loading="lazy" />,
        }}
      >
        {markdown}
      </ReactMarkdown>
    );
  }

  return (
    <div className="cherrywiki-tiptap-content">
      <EditorContent editor={editor} />
    </div>
  );
}
