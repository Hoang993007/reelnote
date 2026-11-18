/**
 * Image markup: rectangles and lines stored beside a block image (like its crop) and drawn over it by
 * the web UI, never into the file. Coordinates are fractions (0..1) of the original image, like the crop.
 */
export const IMAGE_MARKUP_KINDS = ['rect', 'line'] as const;
/** orange, blue and white are the web UI's; the rest come from the original app. */
export const IMAGE_MARKUP_COLORS = ['orange', 'blue', 'white', 'red', 'yellow', 'green', 'cyan'] as const;
export const IMAGE_MARKUP_MAX_SHAPES = 100;

export interface ImageMarkupShape {
  kind: typeof IMAGE_MARKUP_KINDS[number];
  color: typeof IMAGE_MARKUP_COLORS[number];
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const fraction = { type: 'number', minimum: 0, maximum: 1 } as const;

/** Request-body schema of a markup value: the shape list, or null (or an empty list) to remove the markup. */
export const imageMarkupSchema = {
  type: ['array', 'null'],
  maxItems: IMAGE_MARKUP_MAX_SHAPES,
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['kind', 'color', 'x1', 'y1', 'x2', 'y2'],
    properties: {
      kind: { type: 'string', enum: IMAGE_MARKUP_KINDS },
      color: { type: 'string', enum: IMAGE_MARKUP_COLORS },
      x1: fraction,
      y1: fraction,
      x2: fraction,
      y2: fraction,
    },
  },
} as const;

/**
 * The column value for a validated markup: a rectangle by its top-left and bottom-right corners (the renderer draws it
 * from the first by a positive size), a line as drawn; an empty list is stored as NULL, like an uncropped crop.
 */
export function storedImageMarkup(markup: ImageMarkupShape[] | null): ImageMarkupShape[] | null {
  if (!markup || markup.length === 0) return null;
  return markup.map(shape => shape.kind === 'rect'
    ? { ...shape, x1: Math.min(shape.x1, shape.x2), y1: Math.min(shape.y1, shape.y2), x2: Math.max(shape.x1, shape.x2), y2: Math.max(shape.y1, shape.y2) }
    : shape);
}
