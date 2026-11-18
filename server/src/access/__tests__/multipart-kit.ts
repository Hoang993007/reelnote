import type { InjectOptions } from 'fastify';

/** A 1×1 PNG. */
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

/** A multipart body with these fields and, optionally, one PNG file. */
export function multipart(fields: Record<string, string>, file?: { name: string; data: Buffer }): Pick<InjectOptions, 'payload' | 'headers'> {
  const boundary = 'reelnote-test-boundary';
  const parts = Object.entries(fields).map(([k, v]) => `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`);
  const chunks: Buffer[] = [Buffer.from(parts.join(''))];
  if (file) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="x.png"\r\nContent-Type: image/png\r\n\r\n`));
    chunks.push(file.data, Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(chunks), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}
