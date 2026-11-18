import { useState, type CSSProperties } from 'react';
import { fmtTime } from '../lib/format';
import type { BlockImage, MarkupShape } from '../lib/types';

export type Crop = { x: number; y: number; w: number; h: number };

export function cropOf(image: Pick<BlockImage, 'cropX' | 'cropY' | 'cropW' | 'cropH'>): Crop | null {
  const { cropX: x, cropY: y, cropW: w, cropH: h } = image;
  return x != null && y != null && w != null && h != null ? { x, y, w, h } : null;
}

export const imageUrl = (image: Pick<BlockImage, 'filePath'>) => `/${image.filePath}`;

/** "Frame 18:24" for a captured frame, else "Image". */
export function imageLabel(image: Pick<BlockImage, 'sourceSec'>): string {
  return image.sourceSec != null ? `Frame ${fmtTime(image.sourceSec)}` : 'Image';
}

/**
 * The shown region of an image: a box with the crop's aspect ratio, clipping the whole picture moved and scaled
 * so only the crop shows. Styles go through React's style prop (CSSOM), which the CSP allows.
 */
export function cropBoxStyle(crop: Crop | null, natural: { w: number; h: number } | null): { box: CSSProperties; img: CSSProperties } {
  const c = crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const ratio = natural ? (natural.w * c.w) / (natural.h * c.h) : 16 / 9;
  return {
    box: { aspectRatio: String(ratio) },
    img: { width: `${100 / c.w}%`, left: `${(-c.x / c.w) * 100}%`, top: `${(-c.y / c.h) * 100}%`, height: `${100 / c.h}%` },
  };
}

/** Rectangles and lines drawn over the shown region; strokes stay 2 px at any size. */
export function MarkupLayer({ shapes, crop, draft }: { shapes: readonly MarkupShape[] | null; crop: Crop | null; draft?: MarkupShape | null }) {
  if (!shapes?.length && !draft) return null;
  const c = crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const all = [...(shapes ?? []), ...(draft ? [draft] : [])];
  return <svg className="markup-layer" viewBox={`${c.x} ${c.y} ${c.w} ${c.h}`} preserveAspectRatio="none" aria-hidden="true">
    {all.map((s, i) => s.kind === 'rect'
      ? <rect key={i} className={`mk mk-${s.color}`} x={Math.min(s.x1, s.x2)} y={Math.min(s.y1, s.y2)} width={Math.abs(s.x2 - s.x1)} height={Math.abs(s.y2 - s.y1)} />
      : <line key={i} className={`mk mk-${s.color}`} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} />)}
  </svg>;
}

/** A picture with its crop and markup applied (tiles, the Continue card, the viewer when not cropping). */
export function CroppedImage({ image, alt = '', onNatural }: { image: BlockImage; alt?: string; onNatural?: (size: { w: number; h: number }) => void }) {
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const crop = cropOf(image);
  const style = cropBoxStyle(crop, natural);
  return <span className="crop-box" style={style.box}>
    <img src={imageUrl(image)} alt={alt} draggable={false} loading="lazy" style={style.img}
      onLoad={(e) => {
        const size = { w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight };
        setNatural(size);
        onNatural?.(size);
      }} />
    <MarkupLayer shapes={image.markup} crop={crop} />
  </span>;
}

/** Figure width: at most 460 px (or the width chosen in the original app), and narrow enough that a tall picture stays under 520 px. */
function figureWidth(image: BlockImage, natural: { w: number; h: number } | null): number {
  const crop = cropOf(image) ?? { x: 0, y: 0, w: 1, h: 1 };
  const ratio = natural ? (natural.w * crop.w) / (natural.h * crop.h) : 16 / 9;
  return Math.round(Math.min(460, image.displayWidth ?? 460, 520 * ratio));
}

/** A figure in a note (design-spec §6.3): picture (max 460 px, dark backdrop), caption "Frame 18:24 · note"; a click opens the viewer. */
export function Figure({ image, onOpen }: { image: BlockImage | undefined; onOpen: (imageId: number) => void }) {
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  if (!image) return <span className="fig fig-missing">Image unavailable</span>;
  const label = imageLabel(image);
  return <figure className="fig" contentEditable={false} data-image={image.id} style={{ maxWidth: `${figureWidth(image, natural)}px` }}>
    <button type="button" className="fig-img" aria-label={`Open ${label} in the viewer`} onClick={(e) => { e.stopPropagation(); onOpen(image.id); }}>
      <CroppedImage image={image} onNatural={setNatural} />
    </button>
    <figcaption><span className="mono">{label}</span>{image.caption ? ` · ${image.caption}` : ''}</figcaption>
  </figure>;
}
