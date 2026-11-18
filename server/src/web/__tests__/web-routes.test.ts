import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { CONTENT_SECURITY_POLICY } from '../security-headers.js';

let app: FastifyInstance;
let webDir: string;

beforeAll(async () => {
  webDir = mkdtempSync(path.join(os.tmpdir(), 'reelnote-web-'));
  writeFileSync(path.join(webDir, 'index.html'), '<!doctype html><title>Reelnote</title>');
  writeFileSync(path.join(webDir, 'app.js'), 'console.log(1)');
  app = await buildApp({ webDir });
});
afterAll(async () => {
  await app.close();
  rmSync(webDir, { recursive: true, force: true });
});

it('serves the UI without a session, with the security headers', async () => {
  const res = await app.inject({ method: 'GET', url: '/' });
  expect(res.statusCode).toBe(200);
  expect(res.body).toContain('<title>Reelnote</title>');
  expect(res.headers['content-security-policy']).toBe(CONTENT_SECURITY_POLICY);
  expect(res.headers['x-content-type-options']).toBe('nosniff');
  expect(res.headers['x-frame-options']).toBe('DENY');
  expect((await app.inject({ method: 'GET', url: '/app.js' })).statusCode).toBe(200);
});

it('answers a page route of the UI with index.html, and anything else unknown with 404', async () => {
  const page = await app.inject({ method: 'GET', url: '/sources/3/pages/31', headers: { accept: 'text/html' } });
  expect(page.statusCode).toBe(200);
  expect(page.body).toContain('<title>Reelnote</title>');
  expect((await app.inject({ method: 'GET', url: '/missing.js' })).statusCode).toBe(404);
});

it('keeps API answers out of caches and under the same headers', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/health' });
  expect(res.json()).toEqual({ ok: true });
  expect(res.headers['cache-control']).toBe('no-store');
  expect(res.headers['content-security-policy']).toBe(CONTENT_SECURITY_POLICY);
  expect((await app.inject({ method: 'GET', url: '/api/unknown' })).statusCode).toBe(401);
});
