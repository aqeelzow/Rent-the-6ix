import { getRuntime } from '../../../../../../lib/api/runtime';
export const runtime = 'nodejs';
export const GET = (request: Request, context: { params: Promise<{ token: string }> }) => getRuntime().poll(request, context);
