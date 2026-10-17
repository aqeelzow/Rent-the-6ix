import { getRuntime } from '../../../../lib/api/runtime';
export const runtime = 'nodejs';
export const GET = (request: Request, context: { params: Promise<{ id: string }> }) => getRuntime().detail(request, context);
