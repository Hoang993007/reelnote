import { networkInterfaces } from 'node:os';
import { config } from './config.js';
import { closeConnection, DB_PATH, sqlite } from './db/client.js';
import { applyMigrations } from './db/migrate.js';
import { logger } from './lib/logger.js';
import { sessionService } from './auth/session-service.js';
import { userService } from './auth/user-service.js';
import { backupIfDue } from './ops/backup.js';
import { buildApp } from './app.js';

const HOUR_MS = 60 * 60 * 1000;

const applied = applyMigrations(sqlite);
logger.info({ dbPath: DB_PATH, applied }, 'Database ready');
logger.info({ purged: sessionService.purgeExpired() }, 'Expired sessions removed');
if (!userService.owner()) {
  logger.warn('No owner account yet: create it with `pnpm user create --email … --name … --role owner`.');
}

async function dailyChores(): Promise<void> {
  try {
    const backup = await backupIfDue(sqlite, config.dataDir);
    if (backup) logger.info(backup, 'Backup written');
    sessionService.purgeExpired();
  } catch (error) {
    logger.error({ err: error }, 'Daily backup failed');
  }
}

const app = await buildApp();
await app.listen({ host: config.host, port: config.port });
const addresses = config.host === '0.0.0.0'
  ? Object.values(networkInterfaces()).flat().filter(a => a?.family === 'IPv4').map(a => `http://${a!.address}:${config.port}`)
  : [`http://${config.host}:${config.port}`];
logger.info({ addresses, dataDir: config.dataDir }, 'Reelnote listening');

await dailyChores();
const chores = setInterval(() => void dailyChores(), HOUR_MS);

let stopping = false;
async function stop(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, 'Reelnote stopping');
  clearInterval(chores);
  await app.close();
  closeConnection();
  process.exit(0);
}
process.on('SIGINT', () => void stop('SIGINT'));
process.on('SIGTERM', () => void stop('SIGTERM'));
