import { Harness } from './harness';

export default async function Page({ searchParams }: { searchParams: Promise<{ open?: string }> }) {
  const { open } = await searchParams;
  return (
    <main id="main-content" className="mx-auto w-full max-w-3xl px-4 py-10">
      <Harness initiallyOpen={open === '1'} />
    </main>
  );
}
