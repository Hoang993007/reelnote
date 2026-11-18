import type { MarkupShape } from '../lib/types';
import type { Crop } from './figure';

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * A pointer position as fractions (0..1) of the original image, given the box showing `shown` (the crop, or
 * the whole image when null). Markup and crops are stored in these units, like the original app's.
 */
export function toImagePoint(event: { clientX: number; clientY: number }, rect: DOMRect, shown: Crop | null): { x: number; y: number } {
  const c = shown ?? { x: 0, y: 0, w: 1, h: 1 };
  const fx = clamp01((event.clientX - rect.left) / rect.width);
  const fy = clamp01((event.clientY - rect.top) / rect.height);
  return { x: clamp01(c.x + fx * c.w), y: clamp01(c.y + fy * c.h) };
}

/** The rectangle dragged from `a` to `b`, normalized to a positive size. */
export function drawRect(a: { x: number; y: number }, b: { x: number; y: number }): Crop {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

/** Too small to keep (a click or a twitch), measured in screen pixels: `size` is the whole image's on-screen size. */
export function isTiny(shape: MarkupShape, size: { w: number; h: number }): boolean {
  const width = Math.abs(shape.x2 - shape.x1) * size.w;
  const height = Math.abs(shape.y2 - shape.y1) * size.h;
  return shape.kind === 'rect' ? Math.min(width, height) < 6 : Math.hypot(width, height) < 6;
}
