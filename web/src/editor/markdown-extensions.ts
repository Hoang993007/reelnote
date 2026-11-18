import type { Extensions } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import Paragraph from '@tiptap/extension-paragraph';
import Placeholder from '@tiptap/extension-placeholder';

/**
 * Images in stored markdown are inline (a block's images sit in its text), so a line holding only an image is
 * still a paragraph. The stock parser lifts a lone image out of its paragraph for a block-level image node, which
 * would leave an inline node where only blocks may go. From the original app's markdown-extensions.ts.
 */
const InlineImageParagraph = Paragraph.extend({
  parseMarkdown: (token, helpers) => {
    const tokens = token.tokens ?? [];
    if (tokens.length === 1 && tokens[0].type === 'image') return helpers.createNode('paragraph', undefined, helpers.parseInline(tokens));
    return Paragraph.config.parseMarkdown?.(token, helpers) ?? [];
  },
});

/** The extensions block bodies are written with (markdown round-trip). Editors add their own on top. */
export function markdownExtensions(placeholder: string): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      paragraph: false,
      link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } },
    }),
    InlineImageParagraph,
    Markdown,
    Placeholder.configure({ placeholder, showOnlyWhenEditable: true }),
  ];
}
