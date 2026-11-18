// Bundles the server, its CLI and its worker with esbuild; npm packages stay external (installed
// node_modules), migrations are copied beside the bundle (db/migrate.ts reads ./migrations/).
import { cpSync, rmSync } from 'node:fs';
import { build } from 'esbuild';

const shared = { bundle: true, platform: 'node', format: 'esm', target: 'node24', packages: 'external', sourcemap: true, logLevel: 'info' };

rmSync('dist', { recursive: true, force: true });
await build({ ...shared, entryPoints: { start: 'src/start.ts', cli: 'src/cli/main.ts' }, outdir: 'dist' });
await build({ ...shared, entryPoints: { 'video-transcript-worker': 'src/learning/services/video-transcript-worker.ts' }, outdir: 'dist/workers' });
cpSync('src/db/migrations', 'dist/migrations', { recursive: true });
