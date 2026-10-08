import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { copyAssetAsInput, usableAsInputDirectly } from '@/lib/generations/adopt';
import {
  MAX_UPLOAD_BYTES,
  imageFileProblem,
  isAllowedImageType,
  uploadImage,
} from '@/lib/generations/upload';
import { apiError, assetDTO, imageFile, installFakeUploads, json } from './support';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('imageFileProblem', () => {
  it('accepts PNG, JPEG and WebP up to 10 MB', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
      expect(isAllowedImageType(type)).toBe(true);
      expect(imageFileProblem({ type, size: 1024 })).toBeNull();
      expect(imageFileProblem({ type, size: MAX_UPLOAD_BYTES })).toBeNull();
    }
  });

  it('refuses other types before anything is sent', () => {
    for (const type of ['image/gif', 'image/svg+xml', 'application/pdf', 'text/plain', '']) {
      expect(imageFileProblem({ type, size: 10 })).toBe('type');
    }
  });

  it('refuses a file over 10 MB', () => {
    expect(imageFileProblem({ type: 'image/png', size: MAX_UPLOAD_BYTES + 1 })).toBe('size');
  });
});

describe('uploadImage', () => {
  it('posts the file as multipart to /api/v1/uploads and resolves to the stored asset', async () => {
    const uploads = installFakeUploads();
    const onProgress = vi.fn();
    const pending = uploadImage(imageFile('cat.png'), { onProgress });

    expect(uploads).toHaveLength(1);
    expect(uploads[0]?.url).toBe('/api/v1/uploads');
    expect((uploads[0]?.file as File).name).toBe('cat.png');

    uploads[0]?.progress(25, 100);
    uploads[0]?.progress(100, 100);
    expect(onProgress.mock.calls.map(([value]) => value)).toEqual([0.25, 1]);

    const asset = assetDTO({ id: 'ast_abc' });
    uploads[0]?.respond(201, { data: asset });
    await expect(pending).resolves.toEqual(asset);
  });

  it('turns an error envelope into an ApiError with the server code and details', async () => {
    const uploads = installFakeUploads();
    const pending = uploadImage(imageFile());
    uploads[0]?.respond(413, {
      error: { code: 'payload_too_large', message: 'too big', details: { limit: 10 } },
    });
    await expect(pending).rejects.toMatchObject({
      name: 'ApiError',
      code: 'payload_too_large',
      status: 413,
      details: { limit: 10 },
    });
  });

  it('maps a bare failure status to the closest code', async () => {
    const uploads = installFakeUploads();
    const pending = uploadImage(imageFile());
    uploads[0]?.respond(502, 'not json');
    await expect(pending).rejects.toMatchObject({ code: 'internal', status: 502 });
  });

  it('reports a dropped connection as network_error', async () => {
    const uploads = installFakeUploads();
    const pending = uploadImage(imageFile());
    uploads[0]?.fail();
    await expect(pending).rejects.toMatchObject({ code: 'network_error', status: 0 });
  });

  it('rejects a success answer that is not the data envelope', async () => {
    const uploads = installFakeUploads();
    const pending = uploadImage(imageFile());
    uploads[0]?.respond(200, { nope: true });
    await expect(pending).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('can be canceled: the request is aborted and the promise rejects with an AbortError', async () => {
    const uploads = installFakeUploads();
    const controller = new AbortController();
    const pending = uploadImage(imageFile(), { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(uploads[0]?.aborted).toBe(true);
  });

  it('does not start when it is already canceled', async () => {
    const uploads = installFakeUploads();
    const controller = new AbortController();
    controller.abort();
    await expect(uploadImage(imageFile(), { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(uploads).toHaveLength(0);
  });
});

describe('usableAsInputDirectly and copyAssetAsInput', () => {
  it('sends an image result as it is, but never a video', () => {
    expect(usableAsInputDirectly(assetDTO())).toBe(true);
    expect(usableAsInputDirectly(assetDTO({ mimeType: 'image/png' }))).toBe(true);
    expect(usableAsInputDirectly(assetDTO({ kind: 'video', mimeType: 'image/gif' }))).toBe(false);
    expect(usableAsInputDirectly(assetDTO({ kind: 'video', mimeType: 'video/mp4' }))).toBe(false);
    expect(usableAsInputDirectly(assetDTO({ mimeType: 'image/gif' }))).toBe(false);
  });

  it('reads the picture from the media route and uploads it as an input', async () => {
    const uploads = installFakeUploads();
    const fetchMock = vi.fn(
      async () =>
        new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/webp' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const pending = copyAssetAsInput({ id: 'ast_out' });
    await vi.waitFor(() => expect(uploads).toHaveLength(1));
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/media/ast_out', expect.anything());
    expect((uploads[0]?.file as File).type).toBe('image/webp');
    expect((uploads[0]?.file as File).name).toBe('input.webp');
    const copy = assetDTO({ id: 'ast_copy' });
    uploads[0]?.respond(201, { data: copy });
    await expect(pending).resolves.toEqual(copy);
  });

  it('falls back to the still thumbnail when the file itself is a video', async () => {
    const uploads = installFakeUploads();
    const fetchMock = vi.fn(async (url: string) =>
      url.includes('variant=thumb')
        ? new Response(new Uint8Array([9]), { headers: { 'content-type': 'image/webp' } })
        : new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/gif' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const pending = copyAssetAsInput({ id: 'ast_vid' });
    await vi.waitFor(() => expect(uploads).toHaveLength(1));
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/v1/media/ast_vid',
      '/api/v1/media/ast_vid?variant=thumb',
    ]);
    uploads[0]?.respond(201, { data: assetDTO() });
    await pending;
  });

  it('fails with not_found when no picture can be read, and with network_error offline', async () => {
    installFakeUploads();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => apiError(404, 'not_found')),
    );
    await expect(copyAssetAsInput({ id: 'ast_gone' })).rejects.toMatchObject({ code: 'not_found' });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('offline');
      }),
    );
    await expect(copyAssetAsInput({ id: 'ast_x' })).rejects.toBeInstanceOf(ApiError);
    await expect(copyAssetAsInput({ id: 'ast_x' })).rejects.toMatchObject({
      code: 'network_error',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({}, 200)),
    );
  });
});
