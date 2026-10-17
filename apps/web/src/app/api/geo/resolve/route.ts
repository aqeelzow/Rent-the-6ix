import { getRuntime } from '../../../../lib/api/runtime';
export const runtime = 'nodejs';
export const GET = (request: Request) => getRuntime().resolve(request, undefined);
