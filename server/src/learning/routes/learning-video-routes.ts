import type { FastifyInstance } from 'fastify';
import { createVideoStreamRegistry } from '../../lib/stream-file.js';
import { VideoTranscriptCoordinator } from '../services/video-transcript-coordinator.js';
import { createVideoTranscriptService } from '../services/video-transcript-service.js';
import { pageVideoMediaRoutes } from './page-video-media-routes.js';
import { pageVideoProgressRoutes } from './page-video-progress-routes.js';
import { pageVideoRoutes } from './page-video-routes.js';
import { videoLibraryRoutes } from './video-library-routes.js';
import { wordLookupRoutes } from './word-lookup-routes.js';
import { createWordLookupService } from '../../lookup/word-lookup-service.js';
import { config } from '../../config.js';
import { createGeminiAsk } from '../../lookup/gemini-client.js';
import { createGeminiChat } from '../../lookup/gemini-chat.js';
import { lookupKeyService } from '../../lookup/lookup-key-service.js';
import type { AskChat, AskModel, KeyFor } from '../../lookup/word-lookup-types.js';

/** Tests replace the dictionary model (`askModel`, `askChat`) and where a user's key comes from (`keyFor`). */
export type LearningVideoRouteOptions = { askModel?: AskModel; askChat?: AskChat; keyFor?: KeyFor };

/**
 * Every Learning video route, under `/api`; they read local files from the video library root. Owns the open-stream registry so shutdown never waits on a paused player,
 * and the transcript worker, stopped when the app closes.
 */
export async function learningVideoRoutes(app: FastifyInstance, { askModel, askChat, keyFor }: LearningVideoRouteOptions = {}) {
  const streams = createVideoStreamRegistry();
  app.addHook('preClose', async () => streams.destroyAll());
  const coordinator = new VideoTranscriptCoordinator();
  app.addHook('onClose', async () => coordinator.stop());
  const transcripts = createVideoTranscriptService({ extract: absPath => coordinator.extract(absPath) });

  await app.register(videoLibraryRoutes);
  await app.register(pageVideoRoutes);
  await app.register(pageVideoProgressRoutes);
  await app.register(pageVideoMediaRoutes, { streams, transcripts });
  const lookups = createWordLookupService({
    ask: askModel ?? createGeminiAsk(config.geminiModel),
    askChat: askChat ?? createGeminiChat(config.geminiModel),
    keyFor: keyFor ?? (userId => lookupKeyService.keyFor(userId)),
  });
  await app.register(wordLookupRoutes, { transcripts, lookups });
}
