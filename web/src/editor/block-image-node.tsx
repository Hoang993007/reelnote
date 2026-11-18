import { createContext, useContext } from 'react';
import { mergeAttributes, Node, ReactNodeViewRenderer, NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state';
import { blockImageIdFromHref, blockImageRef } from '../lib/markdown';
import type { BlockImage as BlockImageRow } from '../lib/types';
import { Figure } from '../images/figure';

/** What a figure inside an editor needs: the block's images and the viewer. */
export type FigureHost = { images: Map<number, BlockImageRow>; open: (imageId: number) => void };
export const FigureContext = createContext<FigureHost>({ images: new Map(), open: () => undefined });

function BlockImageView({ node, selected }: ReactNodeViewProps) {
  const host = useContext(FigureContext);
  const id = node.attrs.id as number | null;
  return <NodeViewWrapper as="span" className={`fig-node${selected ? ' is-picked' : ''}`} data-drag-handle>
    <Figure image={id === null ? undefined : host.images.get(id)} onOpen={host.open} />
  </NodeViewWrapper>;
}

type Options = {
  /** Image files pasted or dropped into the text: uploaded to the block, then placed (null: not accepted). */
  onFiles: ((files: File[], at: number) => void) | null;
};

const imageFiles = (list: FileList | null | undefined) => [...(list ?? [])].filter((file) => /^image\/(png|jpeg|webp)$/.test(file.type));

/**
 * A block image inside the body, stored in the markdown as `![](block-image:ID)`. Inline and atomic, so it can
 * sit on a line of its own between paragraphs. Adapted from the original app's block-image-node.tsx.
 */
export const BlockImage = Node.create<Options>({
  name: 'blockImage',
  inline: true,
  group: 'inline',
  atom: true,
  draggable: true,
  selectable: true,

  addOptions: () => ({ onFiles: null }),

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element) => Number(element.getAttribute('data-block-image-id')) || null,
        renderHTML: (attributes) => (attributes.id ? { 'data-block-image-id': attributes.id } : {}),
      },
    };
  },

  parseHTML: () => [{ tag: 'img[data-block-image-id]' }],

  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(HTMLAttributes, { alt: '' })];
  },

  markdownTokenName: 'image',
  parseMarkdown: (token, helpers) => {
    const id = blockImageIdFromHref(token.href);
    return id ? helpers.createNode('blockImage', { id }) : helpers.createTextNode(token.raw ?? '');
  },
  renderMarkdown: (node) => (typeof node.attrs?.id === 'number' ? blockImageRef(node.attrs.id) : ''),

  addKeyboardShortcuts() {
    const remove = () => {
      const { selection } = this.editor.state;
      if (!(selection instanceof NodeSelection) || selection.node.type !== this.type) return false;
      this.editor.view.dispatch(this.editor.state.tr.deleteSelection());
      return true;
    };
    return { Backspace: remove, Delete: remove };
  },

  addNodeView() {
    return ReactNodeViewRenderer(BlockImageView, { as: 'span', className: 'block-image-node' });
  },

  addProseMirrorPlugins() {
    const onFiles = this.options.onFiles;
    if (!onFiles) return [];
    return [new Plugin({
      key: new PluginKey('blockImageFiles'),
      props: {
        // Image files alone (a screenshot); a clipboard that also has text pastes the text.
        handlePaste: (view, event) => {
          const files = imageFiles(event.clipboardData?.files);
          if (!files.length || event.clipboardData?.types.includes('text/plain')) return false;
          onFiles(files, view.state.selection.from);
          return true;
        },
        handleDrop: (view, event, _slice, moved) => {
          const files = imageFiles(event.dataTransfer?.files);
          if (!files.length || moved) return false;
          const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
          onFiles(files, at?.pos ?? view.state.doc.content.size);
          return true;
        },
      },
    })];
  },
});
