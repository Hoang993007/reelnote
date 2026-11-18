import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ReelnoteConfig {
  host: string;
  port: number;
  dataDir: string;
  logLevel: string;
  /** Extra origins accepted on state-changing requests, besides the request's own (see auth-hook.ts). */
  allowedOrigins: string[];
  /** The web UI's files, served at `/`. */
  webDir: string;
  /** The Tailscale Serve address, shown on People and access and in a new friend's hand-off; optional. */
  tailscaleUrl: string | null;
  /** A shared Gemini API key for word lookup, used when the app has none set (`lookup/lookup-key-service.ts`). Never logged. */
  geminiApiKey: string | null;
  /** The Gemini model word lookup asks. */
  geminiModel: string;
}

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LOG_LEVELS = new Set(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']);

/** Reads and validates the configuration from the environment (see `.env.example`). */
export function readConfig(env: NodeJS.ProcessEnv = process.env, repoRoot = REPO_ROOT): ReelnoteConfig {
  const host = env.REELNOTE_HOST?.trim() || '127.0.0.1';
  const port = Number(env.REELNOTE_PORT?.trim() || '3900');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`REELNOTE_PORT must be a port number, got "${env.REELNOTE_PORT}"`);
  }
  const dataDir = path.resolve(env.REELNOTE_DATA_DIR?.trim() || 'E:\\ReelnoteData');
  const relative = path.relative(path.resolve(repoRoot), dataDir);
  if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
    throw new Error(`REELNOTE_DATA_DIR must be outside the repo (${repoRoot}), got ${dataDir}`);
  }
  const logLevel = env.REELNOTE_LOG_LEVEL?.trim() || 'info';
  if (!LOG_LEVELS.has(logLevel)) throw new Error(`REELNOTE_LOG_LEVEL is not a log level: ${logLevel}`);
  const allowedOrigins = (env.REELNOTE_ALLOWED_ORIGINS ?? '').split(',').map(o => o.trim().toLowerCase().replace(/\/+$/, '')).filter(Boolean);
  for (const origin of allowedOrigins) {
    if (!/^https?:\/\/[^/\s]+$/.test(origin)) throw new Error(`REELNOTE_ALLOWED_ORIGINS has a value that is not an origin: ${origin}`);
  }
  const tailscaleUrl = env.REELNOTE_TAILSCALE_URL?.trim().replace(/\/+$/, '') || null;
  if (tailscaleUrl && !/^https:\/\/[^/\s]+$/.test(tailscaleUrl)) throw new Error(`REELNOTE_TAILSCALE_URL must be an https origin, got ${tailscaleUrl}`);
  const geminiApiKey = env.REELNOTE_GEMINI_API_KEY?.trim() || null;
  const geminiModel = env.REELNOTE_GEMINI_MODEL?.trim() || 'gemini-3.5-flash-lite';
  if (!/^[a-z0-9.-]+$/.test(geminiModel)) throw new Error(`REELNOTE_GEMINI_MODEL is not a model id: ${geminiModel}`);
  return { host, port, dataDir, logLevel, allowedOrigins, webDir: webDirOf(env, repoRoot), tailscaleUrl, geminiApiKey, geminiModel };
}

/** REELNOTE_WEB_DIR, else the built UI (`web/dist`) when there is one, else `web/public` (a page saying to build it). */
function webDirOf(env: NodeJS.ProcessEnv, repoRoot: string): string {
  if (env.REELNOTE_WEB_DIR?.trim()) return path.resolve(env.REELNOTE_WEB_DIR.trim());
  const built = path.join(repoRoot, 'web', 'dist');
  return existsSync(path.join(built, 'index.html')) ? built : path.join(repoRoot, 'web', 'public');
}

export const config: ReelnoteConfig = readConfig();
