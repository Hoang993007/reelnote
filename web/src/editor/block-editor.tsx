import { useEffect, useRef } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { BlockKind } from '../lib/types';
import { markdownExtensions } from './markdown-extensions';
import { BlockImage } from './block-image-node';

/** What the notebook does for keys typed in a block (design-spec §8, "Page, editing"). */
export type EditorEvents = {
  /** The text changed; `markdown` is the whole body. Debounced by the caller. */
  change: (markdown: string) => void;
  /** Enter at the end (or in a heading or quote): a new text block below. */
  newBlockBelow: () => void;
  /** Backspace in an empty block: remove it and move up. */
  removeEmpty: () => void;
  /** Esc: stop editing; the block stays selected. */
  stop: () => void;
  /** `/` in an empty block: the block-type menu. */
  slash: (anchor: HTMLElement) => void;
  /** `# `, `> ` or `? ` typed at the start of a text block. */
  shortcutKind: (kind: BlockKind) => void;
  togglePlay: () => void;
  seekBy: (seconds: number) => void;
  /** Image files pasted or dropped. */
  files: ((files: File[], at: number) => void) | null;
};

export type ActiveEditor = { blockId: number; editor: Editor };

const SHORTCUTS: Record<string, BlockKind> = { '#': 'heading', '>': 'quote', '?': 'question' };

function isEmptyDoc(editor: Editor): boolean {
  let images = false;
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'blockImage') images = true;
    return !images;
  });
  return !images && !editor.state.doc.textContent.trim();
}

/** Caret at the very end of the document, in a top-level paragraph that has text. */
function atEndOfLastParagraph(view: EditorView): boolean {
  const { selection, doc } = view.state;
  if (!selection.empty) return false;
  const $pos = selection.$from;
  return $pos.depth === 1 && $pos.parent.type.name === 'paragraph' && $pos.parentOffset === $pos.parent.content.size
    && $pos.after() === doc.content.size && $pos.parent.content.size > 0;
}

/**
 * A block's text in edit mode: Tiptap round-tripping markdown (with the original app's extensions). Mounted only for the
 * block being edited; the others show rendered HTML. `at`: where the click that started editing was, so the
 * caret lands there.
 */
export function BlockEditor({ blockId, kind, markdown, placeholder, at, events, onReady }: {
  blockId: number;
  kind: BlockKind;
  markdown: string;
  placeholder: string;
  at: { x: number; y: number } | null;
  events: EditorEvents;
  onReady: (active: ActiveEditor | null) => void;
}) {
  const handlers = useRef(events);
  handlers.current = events;
  const kindRef = useRef(kind);
  kindRef.current = kind;

  const editor = useEditor({
    extensions: [
      ...markdownExtensions(placeholder),
      BlockImage.configure({ onFiles: (files, pos) => handlers.current.files?.(files, pos) }),
    ],
    content: markdown,
    contentType: 'markdown',
    injectCSS: false,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: { class: 'b-edit', spellcheck: 'true', lang: 'vi' },
      handleKeyDown: (view, event) => {
        if (event.isComposing) return false;
        const h = handlers.current;
        const mod = event.ctrlKey || event.metaKey;
        if (mod && event.key === 'Enter') { event.preventDefault(); h.togglePlay(); return true; }
        if (mod && (event.code === 'BracketLeft' || event.code === 'BracketRight')) { event.preventDefault(); h.seekBy(event.code === 'BracketLeft' ? -5 : 5); return true; }
        if (event.key === 'Escape') { event.preventDefault(); h.stop(); return true; }
        const current = editorRef.current;
        if (!current) return false;
        if ((event.key === '/' || (event.code === 'Slash' && !event.shiftKey)) && !mod && !event.altKey && isEmptyDoc(current)) { event.preventDefault(); h.slash(view.dom as HTMLElement); return true; }
        if (event.key === 'Backspace' && !mod && isEmptyDoc(current)) { event.preventDefault(); h.removeEmpty(); return true; }
        if (event.key === 'Enter' && !event.shiftKey && !mod) {
          const k = kindRef.current;
          if (k === 'heading' || k === 'quote') { event.preventDefault(); h.newBlockBelow(); return true; }
          // A question's first Enter starts the answer paragraph; the next one at the end leaves the block.
          if (k === 'question' && view.state.doc.childCount < 2) return false;
          if (k !== 'summary' && atEndOfLastParagraph(view)) { event.preventDefault(); h.newBlockBelow(); return true; }
        }
        return false;
      },
      handleTextInput: (view, from, _to, text) => {
        if (text !== ' ' || kindRef.current !== 'text') return false;
        const $from = view.state.doc.resolve(from);
        if ($from.depth !== 1 || $from.index(0) !== 0) return false;
        const before = $from.parent.textBetween(0, $from.parentOffset);
        const next = SHORTCUTS[before];
        if (!next) return false;
        view.dispatch(view.state.tr.delete(from - before.length, from));
        handlers.current.shortcutKind(next);
        return true;
      },
    },
    onUpdate: ({ editor: current }) => {
      // The same shortcuts when "# " arrives in one piece (an IME, a paste), which handleTextInput does not see.
      const first = current.state.doc.firstChild;
      const marker = kindRef.current === 'text' && first?.type.name === 'paragraph' ? /^([#>?]) /.exec(first.textContent) : null;
      if (marker && current.state.selection.$from.index(0) === 0) {
        current.view.dispatch(current.state.tr.delete(1, 3));
        handlers.current.shortcutKind(SHORTCUTS[marker[1]]);
        return;
      }
      handlers.current.change(current.getMarkdown());
    },
  });
  const editorRef = useRef<Editor | null>(null);
  editorRef.current = editor;

  useEffect(() => {
    if (!editor) return;
    onReady({ blockId, editor });
    // Caret where the click was, else at the end; once the view is in the page (it attaches after this effect).
    // view.focus() is synchronous (Tiptap's focus command waits for an animation frame, which a background tab never runs).
    const timer = setTimeout(() => {
      if (editor.isDestroyed || !editor.view.dom.isConnected) return;
      const pos = at ? editor.view.posAtCoords({ left: at.x, top: at.y })?.pos : undefined;
      editor.commands.setTextSelection(pos ?? TextSelection.atEnd(editor.state.doc).from);
      editor.view.focus();
    }, 0);
    return () => {
      clearTimeout(timer);
      onReady(null);
    };
    // Set up once per editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  return <EditorContent editor={editor} className="b-editor" />;
}
