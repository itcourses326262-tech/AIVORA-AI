import 'server-only';
import type { Page } from '@/lib/api-types';

/** JSON response with the right content type. Use the helpers below for envelope-shaped bodies. */
export function json(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, init);
}

/** 200 `{ data }` */
export function ok<T>(data: T, init?: ResponseInit): Response {
  return json({ data }, init);
}

/** 201 `{ data }` */
export function created<T>(data: T, init?: ResponseInit): Response {
  return json({ data }, { ...init, status: 201 });
}

/** 202 `{ data }` for work accepted but not finished. */
export function accepted<T>(data: T, init?: ResponseInit): Response {
  return json({ data }, { ...init, status: 202 });
}

/** 200 `{ data: T[], nextCursor }` */
export function page<T>(rows: T[], nextCursor: string | null, init?: ResponseInit): Response {
  const body: Page<T> = { data: rows, nextCursor };
  return json(body, init);
}

/** 204 with no body. */
export function noContent(init?: ResponseInit): Response {
  return new Response(null, { ...init, status: 204 });
}
