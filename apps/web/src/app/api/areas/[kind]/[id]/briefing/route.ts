import { getRuntime } from '../../../../../../lib/api/runtime';

export const runtime = 'nodejs';
export const GET = (request: Request, context: { params: Promise<{ kind: string; id: string }> }) => getRuntime().briefing(request, context);
