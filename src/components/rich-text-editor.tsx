"use client";

import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { useState } from "react";

type RichTextEditorProps = {
  /** Markdown source. Plain text with blank-line paragraphs is valid Markdown. */
  initialValue: string;
  /** Name of the hidden input that carries the Markdown on form submission. */
  name: string;
  editable?: boolean;
  placeholder?: string;
  ariaLabel?: string;
};

/**
 * TipTap editor built only from MIT-licensed open-source extensions (no TipTap
 * Pro/Cloud license). Content is stored as Markdown so existing plain-text
 * consumers (emails, agent prompts, issue layout) keep working.
 */
export function RichTextEditor({
  initialValue,
  name,
  editable = true,
  placeholder = "Write the article…",
  ariaLabel = "Article body",
}: RichTextEditorProps) {
  const [markdown, setMarkdown] = useState(initialValue);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        underline: false,
        link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
      }),
      Placeholder.configure({ placeholder }),
      Markdown,
    ],
    content: initialValue,
    contentType: "markdown",
    editable,
    immediatelyRender: false,
    editorProps: {
      attributes: { class: "rich-text-content", "aria-label": ariaLabel, role: "textbox", "aria-multiline": "true" },
    },
    onUpdate: ({ editor: current }) => setMarkdown(current.isEmpty ? "" : current.getMarkdown()),
  });

  return (
    <div className={`rich-text-editor${editable ? "" : " rich-text-editor-readonly"}`}>
      {editable ? (
        <div aria-label="Formatting" className="rich-text-toolbar" role="toolbar">
          {editor ? <FormattingButtons editor={editor} /> : null}
        </div>
      ) : null}
      {editor ? <EditorContent editor={editor} /> : <div className="rich-text-content rich-text-loading">Loading editor…</div>}
      <input name={name} readOnly type="hidden" value={markdown} />
    </div>
  );
}

function FormattingButtons({ editor }: { editor: Editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      strike: e.isActive("strike"),
      h2: e.isActive("heading", { level: 2 }),
      h3: e.isActive("heading", { level: 3 }),
      bulletList: e.isActive("bulletList"),
      orderedList: e.isActive("orderedList"),
      blockquote: e.isActive("blockquote"),
      link: e.isActive("link"),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });

  function toggleLink() {
    if (state.link) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    const href = window.prompt("Link URL", "https://");
    if (!href || href === "https://") return;
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
  }

  const buttons: { label: string; title: string; active?: boolean; disabled?: boolean; run: () => void }[] = [
    { label: "B", title: "Bold", active: state.bold, run: () => editor.chain().focus().toggleBold().run() },
    { label: "I", title: "Italic", active: state.italic, run: () => editor.chain().focus().toggleItalic().run() },
    { label: "S", title: "Strikethrough", active: state.strike, run: () => editor.chain().focus().toggleStrike().run() },
    { label: "H2", title: "Heading", active: state.h2, run: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { label: "H3", title: "Subheading", active: state.h3, run: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
    { label: "• List", title: "Bulleted list", active: state.bulletList, run: () => editor.chain().focus().toggleBulletList().run() },
    { label: "1. List", title: "Numbered list", active: state.orderedList, run: () => editor.chain().focus().toggleOrderedList().run() },
    { label: "❝", title: "Pull quote (fills the layout highlight)", active: state.blockquote, run: () => editor.chain().focus().toggleBlockquote().run() },
    { label: "Link", title: state.link ? "Remove link" : "Add link", active: state.link, run: toggleLink },
    { label: "↶", title: "Undo", disabled: !state.canUndo, run: () => editor.chain().focus().undo().run() },
    { label: "↷", title: "Redo", disabled: !state.canRedo, run: () => editor.chain().focus().redo().run() },
  ];

  return (
    <div className="rich-text-formatting" role="group">
      {buttons.map((button) => (
        <button
          aria-label={button.title}
          aria-pressed={button.active ?? undefined}
          className={`rich-text-button${button.active ? " is-active" : ""}`}
          disabled={button.disabled}
          key={button.label}
          onClick={button.run}
          onMouseDown={(event) => event.preventDefault()}
          title={button.title}
          type="button"
        >
          {button.label}
        </button>
      ))}
    </div>
  );
}
