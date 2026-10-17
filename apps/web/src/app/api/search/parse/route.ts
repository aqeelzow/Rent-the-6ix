import { getRuntime } from '../../../../lib/api/runtime';
export const runtime = 'nodejs';
export const POST = (request: Request) => getRuntime().parse(request, undefined);
