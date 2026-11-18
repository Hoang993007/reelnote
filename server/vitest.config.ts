import os from 'node:os';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * One data dir per run, outside the repo, so tests never touch a real `reelnote.db`. The global setup
 * creates it and applies the migrations; test workers get it through `test.env`.
 */
const RUN_DATA_DIR = (process.env.REELNOTE_TEST_DATA_DIR ??= path.join(os.tmpdir(), `reelnote-test-${process.pid}-${Date.now()}`));

export default defineConfig({
  test: {
    fileParallelism: false,
    globalSetup: ['./test/global-setup.ts'],
    exclude: ['dist/**', 'node_modules/**'],
    env: {
      REELNOTE_DATA_DIR: RUN_DATA_DIR,
      REELNOTE_TEST_DATA_DIR: RUN_DATA_DIR,
      REELNOTE_LOG_LEVEL: 'silent',
    },
  },
});
