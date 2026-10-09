import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { DetailView } from '@/components/gallery/detail-view';
import { resultFromQuery } from '@/components/gallery/links';
import { getAppUser, requireUser } from '@/lib/auth-guard';
import type { GenerationDTO } from '@/lib/api-types';
import { AppError } from '@/lib/errors';
import { clipText } from '@/lib/generations/format';
import { isValidId } from '@/lib/id';
import { getI18n } from '@/lib/i18n/server';
import { getGeneration } from '@/server/generations/service';

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * The creation if it is the user's own. A missing one, someone else's and a malformed id are the
 * same answer (null), so the page cannot be used to find out which ids exist.
 */
const loadOwnCreation = cache(async (userId: string, id: string): Promise<GenerationDTO | null> => {
  if (!isValidId(id, 'gen')) return null;
  try {
    return await getGeneration(userId, id);
  } catch (error) {
    if (error instanceof AppError && error.code === 'not_found') return null;
    throw error;
  }
});

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const [{ id }, { t }] = await Promise.all([params, getI18n()]);
  // The page itself sends a visitor to log in; the title only needs the user when there is one.
  const user = await getAppUser();
  const generation = user ? await loadOwnCreation(user.id, id) : null;
  return { title: generation ? clipText(generation.prompt, 60) : t('gallery.detail.title') };
}

/** One creation of the signed-in user, large, with everything that can be done with it. */
export default async function CreationPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams?: SearchParams;
}) {
  const [{ id }, query] = await Promise.all([
    params,
    searchParams ?? Promise.resolve<Awaited<SearchParams>>({}),
  ]);
  const user = await requireUser(`/gallery/${id}`);
  const generation = await loadOwnCreation(user.id, id);
  if (!generation) notFound();
  return (
    <DetailView
      key={generation.id}
      initial={generation}
      initialIndex={resultFromQuery(query.r, generation.outputs.length)}
    />
  );
}
