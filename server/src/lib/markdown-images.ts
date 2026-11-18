/** Markdown image syntax `![alt](url)`, including Learning block refs `![](block-image:ID)`. */
const MARKDOWN_IMAGE = /!\[[^\]]*\]\([^)]*\)/g;

/** Markdown with its images removed: search must not match an image's URL (every block ref says "block-image"). */
export function stripMarkdownImages(markdown: string): string {
  return markdown.replace(MARKDOWN_IMAGE, '');
}
