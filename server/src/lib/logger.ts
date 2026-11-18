import path from 'node:path';
import pino from 'pino';
import { config } from '../config.js';

/**
 * The process logger: JSON lines to stdout and to a daily file under `<dataDir>/logs` (14 kept),
 * since the server runs hidden from Task Scheduler. Tests log nothing. Never log secrets, tokens or
 * password hashes; the redaction below is a backstop.
 */
function transport() {
  return pino.transport({
    targets: [
      { target: 'pino/file', options: { destination: 1 }, level: config.logLevel },
      {
        target: 'pino-roll',
        options: { file: path.join(config.dataDir, 'logs', 'reelnote'), frequency: 'daily', mkdir: true, limit: { count: 14 } },
        level: config.logLevel,
      },
    ],
  });
}

export const logger = process.env.VITEST
  ? pino({ level: 'silent' })
  : pino({
    level: config.logLevel,
    redact: { paths: ['req.headers.cookie', 'password', 'passwordHash', 'token'], remove: true },
  }, transport());
