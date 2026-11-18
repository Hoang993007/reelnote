import type { ServerResponse } from 'node:http';
import { PassThrough, type Readable } from 'node:stream';
import send from '@fastify/send';
import type { FastifyReply, FastifyRequest } from 'fastify';

const CORP = 'Cross-Origin-Resource-Policy';

/** Responses that are streaming a file, so shutdown can cut them instead of waiting for the client. */
export type VideoStreamRegistry = {
  /** Tracks a response; the returned function hands it the file stream to destroy when the response closes. */
  track(response: ServerResponse): (file: Readable) => void;
  readonly size: number;
  /** Destroys every tracked response (and so its file stream); for `preClose`. */
  destroyAll(): void;
};

export function createVideoStreamRegistry(): VideoStreamRegistry {
  const open = new Set<ServerResponse>();
  return {
    track(response) {
      let file: Readable | null = null;
      // A client that left while the handler was still awaiting has already emitted 'close'.
      let closed = response.destroyed;
      if (!closed) {
        open.add(response);
        // send destroys its fs stream only on finish: an aborted Range request would otherwise keep the fd open.
        response.once('close', () => {
          closed = true;
          file?.destroy();
          open.delete(response);
        });
      }
      return (stream) => {
        if (closed) stream.destroy();
        else file = stream;
      };
    },
    get size() {
      return open.size;
    },
    destroyAll() {
      for (const response of open) response.destroy();
    },
  };
}

type SendError = Error & { status?: number; code?: string; headers?: Record<string, string> };

/**
 * Once the reply carries the file stream (`piped`) or the first byte is out, only the socket can be cut:
 * a second reply would keep send's file headers, and a header set after the first byte throws.
 * Before that: 416 keeps send's `Content-Range`, a missing file becomes `notFound()`, another 4xx
 * (412 from `If-Match`) is answered as is, the rest go to the error handler.
 */
export function handleSendError(reply: FastifyReply, error: SendError, notFound: () => Error, piped = false): void {
  if (piped || reply.raw.headersSent) {
    reply.raw.destroy(error);
    return;
  }
  if (error.status === 416) {
    reply.code(416).header('Content-Range', error.headers?.['Content-Range']).send('');
    return;
  }
  if (error.code === 'ENOENT' || error.status === 404) {
    reply.send(notFound());
    return;
  }
  if (error.status !== undefined && error.status >= 400 && error.status < 500) {
    reply.code(error.status).send('');
    return;
  }
  reply.send(error);
}

/**
 * Streams one file with Range/206, ETag/304 and 416, marked `Cross-Origin-Resource-Policy: same-origin`
 * so only Reelnote's own pages can load it. Same wrap as `@fastify/static`: send writes its status
 * and headers through the reply, so hooks and the error handler still apply.
 */
export function streamFile(
  request: FastifyRequest,
  reply: FastifyReply,
  absPath: string,
  registry: VideoStreamRegistry,
  notFound: () => Error,
): FastifyReply {
  reply.header(CORP, 'same-origin');
  const attachFile = registry.track(reply.raw);
  // send URI-decodes the path, so it gets an encoded one.
  const stream = send(request.raw, encodeURI(absPath), { cacheControl: false, dotfiles: 'allow' });

  const wrap = Object.assign(new PassThrough({
    flush(callback) {
      wrap.finished = true;
      if (reply.raw.statusCode === 304) reply.send('');
      callback();
    },
  }), {
    // send's on-finished cleanup reads this; without it the file stream is destroyed at once.
    finished: false,
    getHeader: reply.getHeader.bind(reply),
    setHeader: reply.header.bind(reply),
    removeHeader: () => {},
  });
  Object.defineProperty(wrap, 'statusCode', {
    get: () => reply.raw.statusCode,
    set: (code: number) => { reply.code(code); },
  });
  // send pipes its file stream before the file opens, so an open failure arrives after this.
  let piped = false;
  wrap.on('pipe', () => {
    piped = true;
    reply.send(wrap);
  });

  stream.on('headers', () => reply.header(CORP, 'same-origin'));
  stream.on('stream', attachFile);
  // Always listened: without a listener send calls `clearHeaders`, which drops CORP.
  stream.on('error', (error: SendError) => handleSendError(reply, error, notFound, piped));
  stream.pipe(wrap);
  return reply;
}
