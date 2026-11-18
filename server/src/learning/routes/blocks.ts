import type { FastifyInstance } from 'fastify';
import { blockService, withoutOthersAnnotations } from '../services/block-service.js';
import { blockOrderService, type BlockPlace } from '../services/block-order-service.js';
import { parseImageSourceFields } from '../services/block-image-service.js';
import { BLOCK_KINDS, QUESTION_STATES, type BlockKind, type QuestionState } from '../../db/schema.js';
import { validateImageMimeType } from '../../lib/file-storage.js';
import type { BlockType, UpdateBlockData } from '../services/block-service.js';
import { idParamSchema } from '../../lib/route-schemas.js';
import { parseBlockVideoStampFields } from '../services/block-video-stamp.js';
import { currentUser as viewerOf } from '../../auth/auth-hook.js';
import { requireEditableBlock, requireReadablePage, requireReadableSource, requireVisibleBlock } from '../../access/guards.js';
import type { Viewer } from '../../access/visibility.js';
import { ForbiddenError } from '../../lib/errors.js';

const optionalId = (value: string | undefined) => (value && value.trim() ? Number(value) : undefined);

function parseBlockFields(fields: Record<string, string>) {
  return {
    type: fields.type as BlockType,
    kind: (fields.kind || undefined) as BlockKind | undefined,
    questionState: (fields.questionState || undefined) as QuestionState | undefined,
    isInsight: fields.isInsight === '1',
    insightCategory: fields.insightCategory || undefined,
    body: fields.body,
    tags: fields.tags,
    pinned: fields.pinned === '1',
    color: fields.color || undefined,
    annotation: fields.annotation,
    imageLayout: (fields.imageLayout as 'wrap' | 'row') || undefined,
    imageNotes: undefined as string[] | undefined,
    imageSource: parseImageSourceFields(fields.imageSourceVideoId, fields.imageSourceSec),
    // `insertAfterBlockId` is the name the original app's clients send.
    afterBlockId: optionalId(fields.afterBlockId ?? fields.insertAfterBlockId),
    beforeBlockId: optionalId(fields.beforeBlockId),
    ...parseBlockVideoStampFields(fields),
  };
}

const anchorId = { type: 'integer', minimum: 1 } as const;
const updateBlockSchema = {
  ...idParamSchema.schema,
  body: {
    type: 'object',
    properties: {
      body: { type: 'string' },
      kind: { type: 'string', enum: BLOCK_KINDS },
      questionState: { type: 'string', enum: QUESTION_STATES },
      tags: { type: 'string' },
      pinned: { type: 'boolean' },
      color: { type: 'string' },
      annotation: { type: 'string' },
      imageLayout: { type: 'string', enum: ['wrap', 'row'] },
      isInsight: { type: 'boolean' },
      insightCategory: { type: 'string' },
      stamp: {
        type: ['object', 'null'],
        required: ['pageVideoId', 'videoTimeSec'],
        properties: { pageVideoId: anchorId, videoTimeSec: { type: 'number', minimum: 0 } },
        additionalProperties: false,
      },
    },
  },
} as const;

function requireKnownKind(fields: { kind?: string; questionState?: string }): string | null {
  if (fields.kind !== undefined && !(BLOCK_KINDS as readonly string[]).includes(fields.kind)) return `kind must be one of ${BLOCK_KINDS.join(', ')}`;
  if (fields.questionState !== undefined && !(QUESTION_STATES as readonly string[]).includes(fields.questionState)) return 'questionState must be open or answered';
  return null;
}

/** A reorder may only move blocks the viewer may change. */
function requireOwnBlocks(viewer: Viewer, positions: Array<{ id: number }>): void {
  for (const { id } of positions) requireEditableBlock(viewer, id);
}

export async function blockRoutes(app: FastifyInstance) {
  // ── Block listing & retrieval ─────────────────────────────────────────────

  app.get<{ Params: { pageId: string } }>(
    '/pages/:pageId/blocks',
    async (req) => {
      requireReadablePage(viewerOf(req), Number(req.params.pageId));
      return blockService.listByPage(Number(req.params.pageId), viewerOf(req));
    }
  );

  app.get<{ Params: { id: string } }>('/blocks/:id', idParamSchema, async (req) => {
    requireVisibleBlock(viewerOf(req), Number(req.params.id));
    return withoutOthersAnnotations([blockService.getById(Number(req.params.id))], viewerOf(req))[0];
  });

  // ── Source insights & standalone blocks ───────────────────────────────────

  app.post<{ Params: { sourceId: string }; Body: { positions: Array<{ id: number; position: number }> } }>(
    '/sources/:sourceId/blocks/reorder',
    async (req, reply) => {
      requireReadableSource(viewerOf(req), Number(req.params.sourceId));
      requireOwnBlocks(viewerOf(req), req.body.positions);
      blockService.reorderStandalone(Number(req.params.sourceId), req.body.positions);
      return reply.code(204).send();
    }
  );

  app.post<{ Params: { sourceId: string } }>(
    '/sources/:sourceId/blocks',
    async (req, reply) => {
      // Checked before the body is read, so nothing is uploaded for a source the viewer cannot open.
      requireReadableSource(viewerOf(req), Number(req.params.sourceId));
      const parts = req.parts();
      const fields: Record<string, string> = {};
      const imageBuffers: Array<{ buffer: Buffer; mimetype: string }> = [];

      for await (const part of parts) {
        if (part.type === 'file') {
          validateImageMimeType(part.mimetype);
          imageBuffers.push({ buffer: await part.toBuffer(), mimetype: part.mimetype });
        } else {
          fields[part.fieldname] = part.value as string;
        }
      }

      if (fields.type !== 'note') return reply.code(400).send({ error: 'type must be note' });
      const data = parseBlockFields(fields);
      const kindProblem = requireKnownKind(data);
      if (kindProblem) return reply.code(400).send({ error: kindProblem });
      data.imageNotes = imageBuffers.map((_, i) => fields[`image${i}_note`] ?? '');
      const block = blockService.createStandaloneBlock(Number(req.params.sourceId), viewerOf(req).id, data, imageBuffers);
      return reply.code(201).send(block);
    }
  );

  // ── Block creation on a page (multipart) ──────────────────────────────────

  app.post<{ Params: { pageId: string } }>(
    '/pages/:pageId/blocks',
    async (req, reply) => {
      // Checked before the body is read, so nothing is uploaded for a page the viewer cannot open.
      requireReadablePage(viewerOf(req), Number(req.params.pageId));
      const parts = req.parts();
      const fields: Record<string, string> = {};
      const imageBuffers: Array<{ buffer: Buffer; mimetype: string }> = [];

      for await (const part of parts) {
        if (part.type === 'file') {
          validateImageMimeType(part.mimetype);
          imageBuffers.push({ buffer: await part.toBuffer(), mimetype: part.mimetype });
        } else {
          fields[part.fieldname] = part.value as string;
        }
      }

      if (fields.type !== 'note') return reply.code(400).send({ error: 'type must be note' });
      const data = parseBlockFields(fields);
      const kindProblem = requireKnownKind(data);
      if (kindProblem) return reply.code(400).send({ error: kindProblem });
      data.imageNotes = imageBuffers.map((_, i) => fields[`image${i}_note`] ?? '');
      for (const anchor of [data.afterBlockId, data.beforeBlockId]) if (anchor !== undefined) requireVisibleBlock(viewerOf(req), anchor);
      const block = blockService.create(Number(req.params.pageId), viewerOf(req).id, data, imageBuffers);
      return reply.code(201).send(block);
    }
  );

  // ── Block update (JSON) ───────────────────────────────────────────────────

  app.put<{ Params: { id: string }; Body: UpdateBlockData }>(
    '/blocks/:id', { schema: updateBlockSchema },
    async (req) => {
      const ref = requireEditableBlock(viewerOf(req), Number(req.params.id));
      // A writer may change another person's note, never its private annotation.
      if (!ref.own && req.body.annotation !== undefined) throw new ForbiddenError('Only the author can change the private annotation.');
      return withoutOthersAnnotations([blockService.update(Number(req.params.id), req.body)], viewerOf(req))[0];
    }
  );

  // Moves a block the viewer may change next to any other block of the page.
  app.put<{ Params: { id: string }; Body: BlockPlace }>(
    '/blocks/:id/position',
    {
      schema: {
        ...idParamSchema.schema,
        body: { type: 'object', properties: { afterBlockId: anchorId, beforeBlockId: anchorId }, additionalProperties: false },
      },
    },
    async (req, reply) => {
      requireEditableBlock(viewerOf(req), Number(req.params.id));
      for (const anchor of [req.body.afterBlockId, req.body.beforeBlockId]) if (anchor !== undefined) requireVisibleBlock(viewerOf(req), anchor);
      blockOrderService.move(Number(req.params.id), req.body);
      return reply.code(204).send();
    }
  );

  // ── Block deletion ────────────────────────────────────────────────────────

  app.delete<{ Params: { id: string } }>('/blocks/:id', idParamSchema, async (req, reply) => {
    requireEditableBlock(viewerOf(req), Number(req.params.id));
    blockService.remove(Number(req.params.id));
    return reply.code(204).send();
  });

  // ── Reorder blocks within a page ─────────────────────────────────────────

  app.patch<{ Params: { pageId: string }; Body: { positions: Array<{ id: number; position: number }> } }>(
    '/pages/:pageId/blocks/reorder',
    async (req, reply) => {
      requireReadablePage(viewerOf(req), Number(req.params.pageId));
      requireOwnBlocks(viewerOf(req), req.body.positions);
      blockService.reorder(Number(req.params.pageId), req.body.positions);
      return reply.code(204).send();
    }
  );
}
