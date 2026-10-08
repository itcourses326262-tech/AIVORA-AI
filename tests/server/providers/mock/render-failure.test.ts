import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderError } from '@/server/providers/errors';
import { captureContext, mockInput, useFakeClock } from './fixtures';

beforeEach(() => useFakeClock());
afterEach(() => {
  vi.doUnmock('@/server/providers/mock/image/art');
  vi.resetModules();
  vi.useRealTimers();
});

async function providerWithBrokenRenderer(
  makeFailure: (ErrorClass: typeof ProviderError) => unknown,
) {
  vi.resetModules();
  const { ProviderError } = await import('@/server/providers/errors');
  const failure = makeFailure(ProviderError);
  vi.doMock('@/server/providers/mock/image/art', () => ({
    ARTWORK_MIME_TYPE: 'image/webp',
    renderArtwork: () => Promise.reject(failure),
  }));
  // Everything is loaded after the reset so that `instanceof` sees the same ProviderError class.
  const { mockProvider } = await import('@/server/providers/mock');
  return { provider: mockProvider, ProviderError, failure };
}

describe('renderer failures', () => {
  it('reports an unexpected rendering error as a non-retryable ProviderError with the cause kept', async () => {
    const boom = new Error('libvips exploded');
    const { provider, ProviderError } = await providerWithBrokenRenderer(() => boom);
    const input = mockInput('text-to-image');
    const job = await provider.submit(input, captureContext().context);
    if (job.mode !== 'async') throw new Error('expected async');
    vi.setSystemTime(Date.now() + (job.meta as { durationMs: number }).durationMs);

    const failure = await provider
      .poll(job.providerJobId, input, captureContext().context, job.meta)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ProviderError);
    expect(failure).toMatchObject({ code: 'unknown', retryable: false });
    expect((failure as ProviderError).cause).toBe(boom);
    expect((failure as ProviderError).userMessage).not.toContain('libvips');
  });

  it('lets a ProviderError from the renderer through untouched', async () => {
    const { provider, failure: original } = await providerWithBrokenRenderer(
      (ProviderError) => new ProviderError('invalid_input', 'bad input'),
    );
    const result = await provider
      .submit(mockInput('text-to-image', { prompt: 'x __sync__' }), captureContext().context)
      .catch((error: unknown) => error);
    expect(result).toBe(original);
  });

  it('lets an abort through untouched, even when the renderer reports it as another error', async () => {
    const controller = new AbortController();
    controller.abort(new Error('aborted'));
    const { provider, ProviderError } = await providerWithBrokenRenderer(
      () => new Error('sharp: aborted'),
    );
    const result = await provider
      .submit(
        mockInput('text-to-image', { prompt: 'x __sync__' }),
        captureContext({ signal: controller.signal }).context,
      )
      .catch((error: unknown) => error);
    expect(result).toMatchObject({ message: 'aborted' });
    expect(result).not.toBeInstanceOf(ProviderError);
  });
});
