import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { newId } from '@/lib/id';
import { generations, users } from '@/server/db/schema';
import { createAsset, createGeneration, createUser } from '../../helpers/factories';
import { freshDb } from '../../helpers/db';

class NotFound extends Error {}
class Redirect extends Error {
  constructor(readonly url: string) {
    super(url);
  }
}

const mocks = vi.hoisted(() => ({
  appUser: vi.fn(),
  optionalUser: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new NotFound('not found');
  },
  redirect: (url: string) => {
    throw new Redirect(url);
  },
  useRouter: () => ({}),
  usePathname: () => '/',
}));
vi.mock('@/lib/i18n/server', async () => {
  const { createTranslator } = await import('@/lib/i18n');
  return { getI18n: async () => createTranslator('en'), getLocale: async () => 'en' };
});
vi.mock('@/lib/auth-guard', async () => {
  const { loginUrl } = await import('@/lib/next-path');
  return {
    getOptionalUser: mocks.optionalUser,
    getAppUser: mocks.appUser,
    requireUser: async (path: string) => {
      const user = await mocks.appUser();
      if (!user) throw new Redirect(loginUrl(path));
      return user;
    },
  };
});

const { default: ExplorePage, generateMetadata: exploreMetadata } =
  await import('@/app/explore/page');
const { default: SharedCreationPage, generateMetadata: shareMetadata } =
  await import('@/app/s/[id]/page');
const { default: GalleryPage } = await import('@/app/(app)/gallery/page');
const { default: CreationPage, generateMetadata: creationMetadata } =
  await import('@/app/(app)/gallery/[id]/page');

const harness = freshDb();
let userCounter = 0;
const ORIGIN = 'http://localhost:3000';

interface Seeded {
  ownerId: string;
  generationId: string;
  assetId: string;
}

/** A finished, public Demo image of a user named like a real person, with an email on file. */
function seedShared(
  extra: {
    userName?: string;
    isPublic?: boolean;
    status?: 'succeeded' | 'failed';
    kind?: 'image' | 'video';
    createdAt?: number;
    userId?: string;
  } = {},
): Seeded {
  const { db } = harness;
  const user = extra.userId
    ? { id: extra.userId }
    : createUser(db, {
        name: extra.userName ?? 'Layla Hassan',
        email: `layla.hassan.${userCounter++}@example.com`,
      });
  const createdAt = extra.createdAt ?? Date.now();
  const video = extra.kind === 'video';
  const generation = createGeneration(db, {
    userId: user.id,
    tool: video ? 'text-to-video' : 'text-to-image',
    status: extra.status ?? 'succeeded',
    isPublic: extra.isPublic ?? true,
    prompt: video ? 'Waves on a black beach' : 'A lone lighthouse at sunset',
    negativePrompt: 'blurry',
    params: video
      ? { aspectRatio: '16:9', count: 1, durationSec: 3, resolution: '480p', seed: 1234 }
      : { aspectRatio: '1:1', count: 1, seed: 1234 },
    cost: 9,
    createdAt,
    updatedAt: createdAt,
  });
  const asset = createAsset(db, {
    userId: user.id,
    generationId: generation.id,
    role: 'output',
    kind: video ? 'video' : 'image',
    mimeType: video ? 'video/mp4' : 'image/webp',
    thumbKey: `u/${user.id}/${generation.id}/thumb.webp`,
  });
  return { ownerId: user.id, generationId: generation.id, assetId: asset.id };
}

/** The first element in a tree whose type is the named component. */
function find(node: ReactNode, name: string): ReactElement | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = find(child, name);
      if (hit) return hit;
    }
    return undefined;
  }
  if (!isValidElement(node)) return undefined;
  const element = node as ReactElement<{ children?: ReactNode }>;
  const type = element.type as { name?: string; displayName?: string } | string;
  if (typeof type !== 'string' && (type.name === name || type.displayName === name)) return element;
  return find(element.props.children, name);
}

function props<T>(element: ReactElement | undefined): T {
  expect(element).toBeDefined();
  return (element as ReactElement<T>).props;
}

beforeEach(() => {
  mocks.appUser.mockReset().mockResolvedValue(null);
  mocks.optionalUser.mockReset().mockResolvedValue(null);
});

describe('/s/[id]', () => {
  const param = (id: string) => ({ params: Promise.resolve({ id }) });

  it('renders a public, finished creation with only what the page shows', async () => {
    const seeded = seedShared();
    const page = await SharedCreationPage(param(seeded.generationId));
    const view = props<{ creation: Record<string, unknown>; origin: string; signedIn: boolean }>(
      find(page, 'ShareView'),
    );
    expect(view.origin).toBe(ORIGIN);
    expect(view.signedIn).toBe(false);
    expect(view.creation).toMatchObject({
      id: seeded.generationId,
      prompt: 'A lone lighthouse at sunset',
      ownerFirstName: 'Layla',
    });
    const text = JSON.stringify(view.creation);
    for (const secret of ['Hassan', 'layla.hassan', '@', '1234', 'cost', seeded.ownerId]) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it('tells the page whether the visitor is signed in', async () => {
    const seeded = seedShared();
    mocks.optionalUser.mockResolvedValue({ id: 'usr_x' });
    const page = await SharedCreationPage(param(seeded.generationId));
    expect(props<{ signedIn: boolean }>(find(page, 'ShareView')).signedIn).toBe(true);
  });

  it.each([
    ['a private creation', () => seedShared({ isPublic: false }).generationId],
    ['a public one that did not succeed', () => seedShared({ status: 'failed' }).generationId],
    ['one that does not exist', () => newId('gen')],
    ['an id that is not an id', () => 'not-an-id'],
  ])('answers 404 for %s', async (_label, make) => {
    const id = make();
    await expect(SharedCreationPage(param(id))).rejects.toBeInstanceOf(NotFound);
  });

  it('answers 404 for a creation whose owner was disabled, as the feed and the media route do', async () => {
    const seeded = seedShared();
    harness.db
      .update(users)
      .set({ disabledAt: Date.now() })
      .where(eq(users.id, seeded.ownerId))
      .run();
    await expect(SharedCreationPage(param(seeded.generationId))).rejects.toBeInstanceOf(NotFound);
  });

  it('answers 404 once the owner makes it private again', async () => {
    const seeded = seedShared();
    await SharedCreationPage(param(seeded.generationId));
    harness.db
      .update(generations)
      .set({ isPublic: false })
      .where(eq(generations.id, seeded.generationId))
      .run();
    await expect(SharedCreationPage(param(seeded.generationId))).rejects.toBeInstanceOf(NotFound);
  });

  it('describes a finished image to link previews with absolute addresses', async () => {
    const seeded = seedShared();
    const metadata = await shareMetadata(param(seeded.generationId));
    expect(metadata.title).toBe('A lone lighthouse at sunset');
    expect(metadata.alternates?.canonical).toBe(`/s/${seeded.generationId}`);
    expect(metadata.robots).toEqual({ index: true, follow: true });
    expect(metadata.openGraph).toMatchObject({
      url: `${ORIGIN}/s/${seeded.generationId}`,
      images: [expect.objectContaining({ url: `${ORIGIN}/api/v1/media/${seeded.assetId}` })],
    });
    expect(metadata.twitter).toMatchObject({ card: 'summary_large_image' });
    expect(JSON.stringify(metadata)).not.toMatch(/Hassan|layla\.hassan|@/);
  });

  it('uses the still frame of a video for the preview', async () => {
    const seeded = seedShared({ kind: 'video' });
    const metadata = await shareMetadata(param(seeded.generationId));
    expect(metadata.openGraph).toMatchObject({
      images: [
        expect.objectContaining({ url: `${ORIGIN}/api/v1/media/${seeded.assetId}?variant=thumb` }),
      ],
    });
  });

  it('has nothing to say for a creation that is not public', async () => {
    const seeded = seedShared({ isPublic: false });
    const metadata = await shareMetadata(param(seeded.generationId));
    expect(metadata.title).toBe('This creation is not available');
    expect(metadata.openGraph).toBeUndefined();
    expect(JSON.stringify(metadata)).not.toContain('lighthouse');
  });
});

describe('/explore', () => {
  const search = (params: Record<string, string> = {}) => ({
    searchParams: Promise.resolve(params),
  });

  function feedProps(page: ReactNode) {
    return props<{
      kind: string;
      initialItems: Array<Record<string, unknown>>;
      initialCursor: string | null;
      createHref: string;
    }>(find(page, 'ExploreFeed'));
  }

  it('is public: a visitor gets the feed, with a link to sign up', async () => {
    seedShared();
    const feed = feedProps(await ExplorePage(search()));
    expect(feed.kind).toBe('all');
    expect(feed.initialItems).toHaveLength(1);
    expect(feed.createHref).toBe('/register?next=%2Fstudio');
  });

  it('sends a signed-in user to the studio', async () => {
    mocks.optionalUser.mockResolvedValue({ id: 'usr_x' });
    expect(feedProps(await ExplorePage(search())).createHref).toBe('/studio');
  });

  it('lists only public, finished creations of enabled accounts, newest first', async () => {
    const now = Date.now();
    const a = seedShared({ createdAt: now - 3000 });
    const b = seedShared({ createdAt: now - 1000 });
    seedShared({ isPublic: false });
    seedShared({ status: 'failed' });
    const gone = seedShared();
    harness.db.update(users).set({ disabledAt: now }).where(eq(users.id, gone.ownerId)).run();
    const feed = feedProps(await ExplorePage(search()));
    expect(feed.initialItems.map((item) => item.id)).toEqual([b.generationId, a.generationId]);
  });

  it('filters by kind from the address and ignores an unknown kind', async () => {
    const image = seedShared();
    const video = seedShared({ kind: 'video' });
    expect(
      feedProps(await ExplorePage(search({ kind: 'video' }))).initialItems.map((i) => i.id),
    ).toEqual([video.generationId]);
    expect(
      feedProps(await ExplorePage(search({ kind: 'image' }))).initialItems.map((i) => i.id),
    ).toEqual([image.generationId]);
    const unknown = feedProps(await ExplorePage(search({ kind: 'audio' })));
    expect(unknown.kind).toBe('all');
    expect(unknown.initialItems).toHaveLength(2);
  });

  it('hands over a cursor when there is a second page', async () => {
    const owner = createUser(harness.db, { name: 'Omar Khalid' });
    const base = Date.now() - 100_000;
    for (let i = 0; i < 25; i += 1) seedShared({ userId: owner.id, createdAt: base + i });
    const feed = feedProps(await ExplorePage(search()));
    expect(feed.initialItems).toHaveLength(24);
    expect(typeof feed.initialCursor).toBe('string');
  });

  it('sends nothing but first names and what the cards show to the browser', async () => {
    seedShared({ userName: 'Layla Hassan' });
    const other = createUser(harness.db, { name: 'omar@example.com', email: 'omar.k@example.com' });
    seedShared({ userId: other.id });
    const feed = feedProps(await ExplorePage(search()));
    const text = JSON.stringify(feed);
    for (const secret of ['Hassan', 'layla.hassan', 'omar', 'example.com', '@', '1234', '"cost"']) {
      expect(text, secret).not.toContain(secret);
    }
    expect(text).toContain('Layla');
    expect(feed.initialItems.map((item) => item.ownerFirstName).sort()).toEqual(['Layla', null]);
  });

  it('is indexable, canonical per kind, and carries the share image on', async () => {
    const parent = Promise.resolve({ openGraph: { images: [{ url: '/opengraph-image.png' }] } });
    const all = await exploreMetadata(search(), parent as never);
    expect(all.alternates?.canonical).toBe('/explore');
    expect(all.robots).toBeUndefined();
    expect(all.openGraph).toMatchObject({ images: [{ url: '/opengraph-image.png' }] });
    const videos = await exploreMetadata(search({ kind: 'video' }), parent as never);
    expect(videos.alternates?.canonical).toBe('/explore?kind=video');
    expect(all.title).toBe('Explore AI images and videos');
  });
});

describe('/gallery', () => {
  const search = (params: Record<string, string> = {}) => ({
    searchParams: Promise.resolve(params),
  });

  it('sends a visitor to log in and back to the same filtered view', async () => {
    await expect(GalleryPage(search({ kind: 'image', q: 'sun set' }))).rejects.toMatchObject({
      url: `/login?next=${encodeURIComponent('/gallery?kind=image&q=sun+set')}`,
    });
  });

  it('shows the gallery with the filters of the address for a signed-in user', async () => {
    mocks.appUser.mockResolvedValue({ id: 'usr_x' });
    const page = await GalleryPage(search({ kind: 'video', favorite: '1', status: 'bogus' }));
    expect(props<{ initialFilters: unknown }>(page as ReactElement).initialFilters).toEqual({
      kind: 'video',
      status: 'all',
      favorite: true,
      q: '',
    });
  });
});

describe('/gallery/[id]', () => {
  const param = (id: string) => ({ params: Promise.resolve({ id }) });

  it('sends a visitor to log in and back to this creation', async () => {
    const id = newId('gen');
    await expect(CreationPage(param(id))).rejects.toMatchObject({
      url: `/login?next=${encodeURIComponent(`/gallery/${id}`)}`,
    });
  });

  it('opens on the result the address asks for, within what the creation has', async () => {
    const seeded = seedShared({ isPublic: false });
    mocks.appUser.mockResolvedValue({ id: seeded.ownerId });
    const render = async (r?: string) =>
      props<{ initialIndex: number }>(
        (await CreationPage({
          ...param(seeded.generationId),
          searchParams: Promise.resolve(r === undefined ? {} : { r }),
        })) as ReactElement,
      ).initialIndex;
    expect(await render()).toBe(0);
    expect(await render('1')).toBe(0);
    // The seeded creation has a single result: any other number is clamped to it.
    expect(await render('5')).toBe(0);
    expect(await render('junk')).toBe(0);
  });

  it('gives the owner the whole creation, private details included', async () => {
    const seeded = seedShared({ isPublic: false });
    mocks.appUser.mockResolvedValue({ id: seeded.ownerId });
    const page = (await CreationPage(param(seeded.generationId))) as ReactElement;
    expect(props<{ initial: Record<string, unknown> }>(page).initial).toMatchObject({
      id: seeded.generationId,
      cost: 9,
      isPublic: false,
      negativePrompt: 'blurry',
    });
  });

  it('answers 404 for a creation of somebody else, public or not, exactly like a missing one', async () => {
    const mine = createUser(harness.db);
    const theirs = seedShared({ isPublic: true });
    mocks.appUser.mockResolvedValue({ id: mine.id });
    await expect(CreationPage(param(theirs.generationId))).rejects.toBeInstanceOf(NotFound);
    await expect(CreationPage(param(newId('gen')))).rejects.toBeInstanceOf(NotFound);
    await expect(CreationPage(param('not-an-id'))).rejects.toBeInstanceOf(NotFound);
  });

  it('titles the tab with the prompt for the owner and with a neutral title for anybody else', async () => {
    const seeded = seedShared();
    mocks.appUser.mockResolvedValue({ id: seeded.ownerId });
    expect((await creationMetadata(param(seeded.generationId))).title).toBe(
      'A lone lighthouse at sunset',
    );
    mocks.appUser.mockResolvedValue({ id: createUser(harness.db).id });
    expect((await creationMetadata(param(seeded.generationId))).title).toBe('Creation');
    mocks.appUser.mockResolvedValue(null);
    expect((await creationMetadata(param(seeded.generationId))).title).toBe('Creation');
  });
});
