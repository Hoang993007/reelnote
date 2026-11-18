import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';

const require = createRequire(import.meta.url);

/**
 * Starts the worker module `<workerBaseName>` that sits next to `callerUrl`.
 *
 * From source (`.ts`, dev and tests) the worker registers tsx first, so it can import TypeScript.
 * From the build, workers are bundled to `dist/workers/<name>.js` beside the server entry.
 */
export function createModuleWorker(callerUrl: string, workerBaseName: string, workerData: Record<string, unknown> = {}): Worker {
  if (callerUrl.endsWith('.ts')) {
    const entry = new URL(`./${workerBaseName}.ts`, callerUrl).href;
    const tsx = pathToFileURL(require.resolve('tsx/esm/api')).href;
    const bootstrap = `
      (async () => {
        (await import(${JSON.stringify(tsx)})).register();
        await import(${JSON.stringify(entry)});
      })().catch((error) => setImmediate(() => { throw error; }));
    `;
    return new Worker(bootstrap, { eval: true, workerData });
  }
  const serverEntry = process.argv[1];
  const workerDir = serverEntry
    ? path.join(path.dirname(path.resolve(serverEntry)), 'workers')
    : path.join(path.dirname(fileURLToPath(callerUrl)), 'workers');
  return new Worker(pathToFileURL(path.join(workerDir, `${workerBaseName}.js`)), { workerData });
}
