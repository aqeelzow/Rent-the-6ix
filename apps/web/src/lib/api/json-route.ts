import { z } from 'zod';
import { RateLimitError } from '../parse/cache';
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
async function readBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(422, 'validation_error', 'A JSON body is required');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 65536) { await reader.cancel(); throw new ApiError(422, 'validation_error', 'JSON body exceeds 64 KiB'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new ApiError(422, 'validation_error', 'Malformed JSON body'); }
}
export function jsonRoute<T = undefined, C = unknown>(options: { name: string; body?: z.ZodType<T>; rateLimit?: (request: Request) => void }, handler: (input: T, request: Request, context: C) => Promise<unknown>) {
  return async (request: Request, context: C): Promise<Response> => {
    try {
      options.rateLimit?.(request);
      const input = options.body ? options.body.parse(await readBody(request)) : undefined as T;
      const value = await handler(input, request, context);
      return Response.json(value, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      let status = 500, body: object = { error: { code: 'internal_error', message: 'Search service encountered an error' } };
      const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
      if (error instanceof z.ZodError) { status = 422; body = { error: { code: 'validation_error', message: 'Invalid request', issues: error.issues.map(i => ({ path: i.path.map(p => typeof p === 'symbol' ? String(p) : p), message: i.message })) } }; }
      else if (error instanceof RateLimitError) { status = 429; headers['Retry-After'] = String(error.retryAfterSeconds); body = { error: { code: 'rate_limited', message: 'Too many requests', retryAfterSeconds: error.retryAfterSeconds } }; }
      else if (error instanceof ApiError) { status = error.status; body = { error: { code: error.code, message: error.message } }; }
      return Response.json(body, { status, headers });
    }
  };
}
