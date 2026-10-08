import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  UNDOCUMENTED_ROUTES,
  apiPathOfRouteFile,
  coverageProblems,
  exportedMethods,
  type RouteFileInfo,
} from '@/lib/openapi/routes';
import { buildOpenApiDocument } from '@/lib/openapi/spec';

const V1 = join(__dirname, '..', '..', '..', 'src', 'app', 'api', 'v1');
const doc = buildOpenApiDocument('https://aivore.example');

function* routeFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* routeFiles(full);
    else if (name === 'route.ts') yield full;
  }
}

function scan(): RouteFileInfo[] {
  return [...routeFiles(V1)].map((file) => {
    const path = apiPathOfRouteFile(relative(V1, file).split('\\').join('/'));
    if (path === undefined) throw new Error(`Not a route file: ${file}`);
    return { path, methods: exportedMethods(readFileSync(file, 'utf8')) };
  });
}

describe('apiPathOfRouteFile', () => {
  it('turns folders into an OpenAPI path', () => {
    expect(apiPathOfRouteFile('generations/route.ts')).toBe('/generations');
    expect(apiPathOfRouteFile('generations/[id]/cancel/route.ts')).toBe('/generations/{id}/cancel');
    expect(apiPathOfRouteFile('media/[assetId]/route.ts')).toBe('/media/{assetId}');
    expect(apiPathOfRouteFile('openapi.json/route.ts')).toBe('/openapi.json');
  });

  it('ignores files that are not route handlers', () => {
    expect(apiPathOfRouteFile('generations/limits.ts')).toBeUndefined();
    expect(apiPathOfRouteFile('route.ts')).toBeUndefined();
  });
});

describe('exportedMethods', () => {
  it('reads the handlers a route file exports', () => {
    expect(
      exportedMethods(`
        export const runtime = 'nodejs';
        export const GET = route({}, () => 1);
        export async function POST() {}
        const DELETE = 1;
        export const HEAD = route({}, () => 1);
      `),
    ).toEqual(['get', 'head', 'post']);
  });
});

describe('the document and the route files of src/app/api/v1', () => {
  it('describe the same API', () => {
    const routes = scan();
    expect(routes.length).toBeGreaterThan(25);
    expect(coverageProblems({ routes, document: doc })).toEqual([]);
  });

  it('keep every route either documented or excluded with a reason', () => {
    for (const reason of Object.values(UNDOCUMENTED_ROUTES)) {
      expect(reason.length).toBeGreaterThan(30);
    }
    for (const path of Object.keys(UNDOCUMENTED_ROUTES)) {
      expect(doc.paths[path], `${path} is both documented and excluded`).toBeUndefined();
    }
  });
});

describe('coverageProblems (the checker itself)', () => {
  const known = scan();

  it('fails for a route file the document does not describe', () => {
    const routes = [...known, { path: '/reports', methods: ['get' as const] }];
    expect(coverageProblems({ routes, document: doc })).toEqual([
      expect.stringContaining('/reports (get) has a route file but is not in the document'),
    ]);
  });

  it('fails for a path of the document that has no route file', () => {
    const routes = known.filter((route) => route.path !== '/tools');
    expect(coverageProblems({ routes, document: doc })).toEqual([
      '/tools is in the document but has no route file',
    ]);
  });

  it('fails when a route exports a method the document lacks, and the other way round', () => {
    const extra = known.map((route) =>
      route.path === '/models' ? { ...route, methods: [...route.methods, 'post' as const] } : route,
    );
    expect(coverageProblems({ routes: extra, document: doc })).toEqual([
      '/models: the route exports POST but the document does not describe it',
    ]);
    const fewer = known.map((route) =>
      route.path === '/keys/{id}' ? { ...route, methods: [] } : route,
    );
    expect(coverageProblems({ routes: fewer, document: doc })).toEqual([
      '/keys/{id}: the document describes DELETE but the route does not export it',
    ]);
  });

  it('fails for an exclusion that matches no route and for a path that is both', () => {
    expect(
      coverageProblems({
        routes: known,
        document: doc,
        excluded: { ...UNDOCUMENTED_ROUTES, '/gone': 'A reason that is long enough to read.' },
      }),
    ).toEqual(['/gone is listed as undocumented but has no route file']);
    expect(
      coverageProblems({
        routes: known,
        document: doc,
        excluded: { ...UNDOCUMENTED_ROUTES, '/models': 'Deliberately hidden, supposedly.' },
      }),
    ).toEqual(['/models is both documented and listed as undocumented']);
  });
});
