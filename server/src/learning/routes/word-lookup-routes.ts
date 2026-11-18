import type { FastifyInstance } from 'fastify';
import { currentUser as viewerOf } from '../../auth/auth-hook.js';
import { requireReadablePageVideo } from '../../access/guards.js';
import { MAX_CHAT_TURNS, type WordLookupService } from '../../lookup/word-lookup-service.js';
import type { ChatTurn } from '../../lookup/word-lookup-types.js';
import type { VideoTranscriptService } from '../services/video-transcript-service.js';

export type WordLookupRouteOptions = { transcripts: VideoTranscriptService; lookups: WordLookupService };

/**
 * What a word or phrase selected in a video's transcript means in its line (`lookup/`), and follow-up questions
 * about it. The line is read from the video the viewer can see; the client only names it and the selection, which
 * must be in it.
 */
export async function wordLookupRoutes(app: FastifyInstance, { transcripts, lookups }: WordLookupRouteOptions) {
  app.post<{ Params: { id: number }; Body: { line: number; lineEnd?: number; text: string } }>(
    '/page-videos/:id/word-lookup',
    {
      schema: {
        params: { type: 'object', required: ['id'], properties: { id: { type: 'integer', minimum: 1 } } },
        body: {
          type: 'object',
          required: ['line', 'text'],
          additionalProperties: false,
          properties: {
            line: { type: 'integer', minimum: 0 },
            lineEnd: { type: 'integer', minimum: 0 },
            text: { type: 'string', minLength: 1, maxLength: 600 },
          },
        },
      },
    },
    async req => {
      const viewer = viewerOf(req);
      requireReadablePageVideo(viewer, req.params.id);
      const { cues } = await transcripts.read(req.params.id);
      return lookups.lookup(viewer.id, cues, req.body, req.body.text);
    },
  );

  // Follow-up questions about a lookup, answered with the line, the first answer and the chat so far.
  app.post<{ Params: { id: number }; Body: { line: number; lineEnd?: number; text: string; turns: ChatTurn[] } }>(
    '/page-videos/:id/word-chat',
    {
      schema: {
        params: { type: 'object', required: ['id'], properties: { id: { type: 'integer', minimum: 1 } } },
        body: {
          type: 'object',
          required: ['line', 'text', 'turns'],
          additionalProperties: false,
          properties: {
            line: { type: 'integer', minimum: 0 },
            lineEnd: { type: 'integer', minimum: 0 },
            text: { type: 'string', minLength: 1, maxLength: 600 },
            turns: {
              type: 'array',
              minItems: 1,
              maxItems: MAX_CHAT_TURNS,
              items: {
                type: 'object',
                required: ['role', 'text'],
                additionalProperties: false,
                properties: { role: { enum: ['user', 'model'] }, text: { type: 'string', minLength: 1, maxLength: 4000 } },
              },
            },
          },
        },
      },
    },
    async req => {
      const viewer = viewerOf(req);
      requireReadablePageVideo(viewer, req.params.id);
      const { cues } = await transcripts.read(req.params.id);
      return lookups.chat(viewer.id, cues, req.body, req.body.text, req.body.turns);
    },
  );
}
