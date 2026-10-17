import { getRuntime } from '../../../../../lib/api/runtime';

export const runtime = 'nodejs';
export const POST = (request: Request, context: { params: Promise<{ id: string }> }) => getRuntime().explain(request, context);
