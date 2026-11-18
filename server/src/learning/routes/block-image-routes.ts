import type { FastifyInstance } from 'fastify';
import { blockService } from '../services/block-service.js';
import { blockImageService, parseImageSourceFields } from '../services/block-image-service.js';
import { validateImageMimeType } from '../../lib/file-storage.js';
import { imageMarkupSchema, type ImageMarkupShape } from '../../lib/image-markup.js';
import { idParamSchema } from '../../lib/route-schemas.js';
import { currentUser as viewerOf } from '../../auth/auth-hook.js';
import { requireEditableBlock, requireEditableImage } from '../../access/guards.js';

const markupBodySchema = {
  schema: {
    params: idParamSchema.schema.params,
    body: { type: 'object', required: ['markup'], properties: { markup: imageMarkupSchema } },
  },
} as const;

/** Learning block images: upload, display width, note, crop, markup, order, removal. */
export async function blockImageRoutes(app: FastifyInstance) {
  app.post<{ Params: { id: string } }>('/blocks/:id/images', idParamSchema, async (req, reply) => {
    requireEditableBlock(viewerOf(req), Number(req.params.id));
    const parts = req.parts();
    const imageBuffers: Array<{ buffer: Buffer; mimetype: string }> = [];
    const fields: Record<string, string> = {};
    for await (const part of parts) {
      if (part.type === 'file') {
        validateImageMimeType(part.mimetype);
        imageBuffers.push({ buffer: await part.toBuffer(), mimetype: part.mimetype });
      } else {
        fields[part.fieldname] = part.value as string;
      }
    }
    if (imageBuffers.length === 0) return reply.code(400).send({ error: 'No images provided' });
    // A captured frame says where it came from (a video of this block's page and the second).
    blockImageService.addImages(Number(req.params.id), imageBuffers, parseImageSourceFields(fields.sourceVideoId, fields.sourceSec));
    return blockService.getById(Number(req.params.id));
  });

  app.patch<{ Params: { id: string }; Body: { displayWidth: number } }>(
    '/block-images/:id/display-width', async (req, reply) => {
      requireEditableImage(viewerOf(req), Number(req.params.id));
      const { displayWidth } = req.body;
      if (!Number.isInteger(displayWidth) || displayWidth < 160 || displayWidth > 1600) {
        return reply.code(400).send({ error: 'displayWidth must be an integer 160–1600 (pixels)' });
      }
      blockImageService.updateDisplayWidth(Number(req.params.id), Math.round(displayWidth));
      return reply.code(204).send();
    }
  );

  app.patch<{ Params: { id: string }; Body: { note: string } }>(
    '/block-images/:id/note', async (req, reply) => {
      requireEditableImage(viewerOf(req), Number(req.params.id));
      blockImageService.updateNote(Number(req.params.id), req.body.note ?? '');
      return reply.code(204).send();
    }
  );

  app.patch<{ Params: { id: string }; Body: { x?: number; y?: number; w?: number; h?: number; reset?: boolean } }>(
    '/block-images/:id/crop', async (req, reply) => {
      requireEditableImage(viewerOf(req), Number(req.params.id));
      const { reset, x, y, w, h } = req.body;
      if (reset) {
        blockImageService.updateCrop(Number(req.params.id), null);
      } else {
        if ([x, y, w, h].some(v => typeof v !== 'number')) {
          return reply.code(400).send({ error: 'crop requires x, y, w, h as numbers' });
        }
        blockImageService.updateCrop(Number(req.params.id), { x: x!, y: y!, w: w!, h: h! });
      }
      return reply.code(204).send();
    }
  );

  app.patch<{ Params: { id: string }; Body: { markup: ImageMarkupShape[] | null } }>(
    '/block-images/:id/markup', markupBodySchema, async (req, reply) => {
      requireEditableImage(viewerOf(req), Number(req.params.id));
      blockImageService.updateMarkup(Number(req.params.id), req.body.markup);
      return reply.code(204).send();
    }
  );

  app.patch<{ Params: { id: string }; Body: { positions: Array<{ id: number; position: number }> } }>(
    '/blocks/:id/images/reorder', async (req, reply) => {
      requireEditableBlock(viewerOf(req), Number(req.params.id));
      blockImageService.reorder(Number(req.params.id), req.body.positions ?? []);
      return reply.code(204).send();
    }
  );

  app.delete<{ Params: { id: string } }>('/block-images/:id', idParamSchema, async (req, reply) => {
    requireEditableImage(viewerOf(req), Number(req.params.id));
    blockImageService.remove(Number(req.params.id));
    return reply.code(204).send();
  });
}
