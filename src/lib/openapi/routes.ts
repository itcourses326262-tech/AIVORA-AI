import type { HttpMethod, OpenApiDocument } from './types';

const SIGN_IN_PAGE =
  'Serves the web app’s sign-in page: the browser posts the Firebase ID token it got from the Google popup, so it is not a developer API. It answers 404 while Google sign-in is not configured.';

const CHECKOUT =
  'Part of the web app’s checkout flow: it needs a browser session (an API key is refused) and serves the shop UI, so it is not a developer API.';

/**
 * Routes under `src/app/api/v1` that are deliberately NOT in the document, with the reason. The
 * coverage test fails for a route that is neither documented nor listed here, and for an entry
 * here that matches no route file, so nothing is left out by accident.
 */
export const UNDOCUMENTED_ROUTES: Readonly<Record<string, string>> = {
  '/auth/firebase': SIGN_IN_PAGE,
  '/billing/plans': CHECKOUT,
  '/billing/checkout': CHECKOUT,
  '/billing/orders': CHECKOUT,
  '/billing/orders/{id}': CHECKOUT,
  '/billing/subscription': CHECKOUT,
  '/billing/subscription/cancel': CHECKOUT,
  '/billing/subscription/resume': CHECKOUT,
  '/billing/return':
    'Where the payment page sends the buyer’s browser after paying: a redirect, not an API.',
  '/billing/webhooks/moyasar':
    'Called by the payment gateway and authenticated by its shared secret, never by developers.',
};

/** The names Next.js serves a Route Handler from: `route` with a default page extension. */
const ROUTE_FILE_NAME = /^route\.(?:js|jsx|ts|tsx)$/;

export function isRouteFileName(name: string): boolean {
  return ROUTE_FILE_NAME.test(name);
}

/**
 * The OpenAPI path of a route file, given its location below `src/app/api/v1`:
 * `generations/[id]/cancel/route.ts` is `/generations/{id}/cancel` (`route.js`, `route.tsx` and
 * `route.jsx` count as well). Undefined for any other file.
 */
export function apiPathOfRouteFile(fileBelowV1: string): string | undefined {
  const segments = fileBelowV1.split('/');
  if (!isRouteFileName(segments.pop() ?? '') || segments.length === 0) return undefined;
  return `/${segments.map((segment) => segment.replace(/^\[(\w+)\]$/, '{$1}')).join('/')}`;
}

/** Every path of the document with the methods it describes. */
export function documentedMethods(document: OpenApiDocument): Map<string, HttpMethod[]> {
  return new Map(
    Object.entries(document.paths).map(([path, item]) => [
      path,
      (Object.keys(item) as HttpMethod[]).toSorted(),
    ]),
  );
}

/** What the scan of `src/app/api/v1` found for one route file. */
export interface RouteFileInfo {
  /** The OpenAPI path, from {@link apiPathOfRouteFile}. */
  path: string;
  /** The HTTP methods the file exports a handler for. */
  methods: readonly HttpMethod[];
}

const EXPORTED_HANDLER =
  /export\s+(?:const|async\s+function|function)\s+(GET|POST|PUT|PATCH|DELETE|HEAD)\b/g;

/** The handler methods a route file exports, read from its source text. */
export function exportedMethods(source: string): HttpMethod[] {
  const methods = new Set<HttpMethod>();
  for (const match of source.matchAll(EXPORTED_HANDLER)) {
    methods.add((match[1] ?? '').toLowerCase() as HttpMethod);
  }
  return [...methods].toSorted();
}

/**
 * Differences between the route files and the document, as sentences. Empty when every route is
 * described (or excluded with a reason), every described path has a route, and the methods agree.
 */
export function coverageProblems(input: {
  routes: readonly RouteFileInfo[];
  document: OpenApiDocument;
  excluded?: Readonly<Record<string, string>>;
}): string[] {
  const { routes, document, excluded = UNDOCUMENTED_ROUTES } = input;
  const documented = documentedMethods(document);
  const byPath = new Map(routes.map((route) => [route.path, route]));
  const problems: string[] = [];

  for (const route of routes) {
    const methods = documented.get(route.path);
    const reason = excluded[route.path];
    if (methods && reason !== undefined) {
      problems.push(`${route.path} is both documented and listed as undocumented`);
    } else if (!methods && reason === undefined) {
      problems.push(
        `${route.path} (${route.methods.join(', ')}) has a route file but is not in the document: describe it or list it in UNDOCUMENTED_ROUTES with a reason`,
      );
    }
    if (!methods) continue;
    for (const method of route.methods) {
      if (!methods.includes(method)) {
        problems.push(
          `${route.path}: the route exports ${method.toUpperCase()} but the document does not describe it`,
        );
      }
    }
    for (const method of methods) {
      if (!route.methods.includes(method)) {
        problems.push(
          `${route.path}: the document describes ${method.toUpperCase()} but the route does not export it`,
        );
      }
    }
  }
  for (const path of documented.keys()) {
    if (!byPath.has(path)) problems.push(`${path} is in the document but has no route file`);
  }
  for (const path of Object.keys(excluded)) {
    if (!byPath.has(path)) problems.push(`${path} is listed as undocumented but has no route file`);
  }
  return problems;
}
