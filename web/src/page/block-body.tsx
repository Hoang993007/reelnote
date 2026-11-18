import { memo, useMemo } from 'react';
import { bodyWithImages, plainText, renderMarkdown, segments } from '../lib/markdown';
import type { BlockImage } from '../lib/types';
import { Figure } from '../images/figure';

/** A block's text as the reading view shows it: sanitized markdown with figures between the text segments. */
export const BlockBody = memo(function BlockBody({ body, images, plain, onOpenImage }: {
  body: string;
  images: BlockImage[];
  /** One line of plain text (a heading). */
  plain?: boolean;
  onOpenImage: (imageId: number) => void;
}) {
  const parts = useMemo(() => {
    if (plain) return null;
    return segments(bodyWithImages(body, images.map((i) => i.id))).map((part) => (part.kind === 'text' ? { ...part, html: renderMarkdown(part.markdown) } : part));
  }, [body, images, plain]);
  if (plain) return <>{plainText(body)}</>;
  const byId = new Map(images.map((i) => [i.id, i]));
  return <>
    {parts!.map((part, i) => (part.kind === 'image'
      ? <Figure key={`i${part.id}`} image={byId.get(part.id)} onOpen={onOpenImage} />
      : <div key={`t${i}`} className="md" dangerouslySetInnerHTML={{ __html: part.html }} />))}
  </>;
});
