'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { isApiError } from '@/lib/api-client';
import type { AssetDTO } from '@/lib/api-types';
import { copyAssetAsInput, usableAsInputDirectly } from '@/lib/generations/adopt';
import { imageFileProblem, uploadImage } from '@/lib/generations/upload';

export type ImageInputError =
  { kind: 'type' | 'size' | 'import' } | { kind: 'api'; error: unknown };

export type ImageInputState =
  | { status: 'empty'; error?: ImageInputError }
  | { status: 'uploading'; name: string; previewUrl: string | null; progress: number }
  | { status: 'importing'; previewUrl: string | null }
  | {
      status: 'ready';
      assetId: string;
      previewUrl: string;
      name?: string;
      width?: number;
      height?: number;
      /** `asset`: an existing result sent as it is; `upload`: a file stored as an input. */
      source: 'upload' | 'asset';
      /** Still picture to copy from when the engine refuses `assetId` (see `recover`). */
      thumbUrl?: string;
    };

/** An existing asset to use as the input image. */
export interface AdoptSource {
  id: string;
  /** Known when the asset comes from a card; absent for a bare id from the URL. */
  asset?: AssetDTO;
}

const EMPTY: ImageInputState = { status: 'empty' };

function objectUrl(blob: Blob): string | null {
  return typeof URL.createObjectURL === 'function' ? URL.createObjectURL(blob) : null;
}

function revoke(url: string | null | undefined): void {
  if (url && url.startsWith('blob:') && typeof URL.revokeObjectURL === 'function') {
    URL.revokeObjectURL(url);
  }
}

export interface ImageInput {
  state: ImageInputState;
  /** Validates and uploads a picked, dropped or pasted file. */
  accept: (file: File) => void;
  /** Uses an existing result (or uploaded input) without picking a file. */
  adopt: (source: AdoptSource) => void;
  /** Replaces a refused asset with an uploaded copy; resolves to the new asset id. */
  recover: () => Promise<string | null>;
  /** Removes the picture, or stops the upload in progress. */
  clear: () => void;
}

/**
 * The input image of the image tools: its upload (with progress and cancellation), an existing
 * result adopted as input, and the object URLs that preview a file before the server has it.
 */
export function useImageInput(): ImageInput {
  const [state, setState] = useState<ImageInputState>(EMPTY);
  const controller = useRef<AbortController | null>(null);
  const preview = useRef<string | null>(null);

  const release = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    revoke(preview.current);
    preview.current = null;
  }, []);

  useEffect(() => release, [release]);

  const fail = useCallback((error: unknown, kind: 'import' | 'api') => {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    setState({ status: 'empty', error: kind === 'api' ? { kind: 'api', error } : { kind } });
  }, []);

  const accept = useCallback(
    (file: File) => {
      const problem = imageFileProblem(file);
      if (problem) {
        setState({ status: 'empty', error: { kind: problem } });
        return;
      }
      release();
      const previewUrl = objectUrl(file);
      preview.current = previewUrl;
      const run = new AbortController();
      controller.current = run;
      setState({ status: 'uploading', name: file.name, previewUrl, progress: 0 });
      uploadImage(file, {
        signal: run.signal,
        onProgress: (progress) =>
          setState((current) =>
            current.status === 'uploading' ? { ...current, progress } : current,
          ),
      }).then(
        (asset) => {
          if (run.signal.aborted) return;
          setState({
            status: 'ready',
            assetId: asset.id,
            previewUrl: previewUrl ?? asset.thumbUrl ?? asset.url,
            name: file.name,
            width: asset.width,
            height: asset.height,
            source: 'upload',
          });
        },
        (error: unknown) => {
          if (run.signal.aborted) return;
          revoke(previewUrl);
          preview.current = null;
          fail(error, 'api');
        },
      );
    },
    [release, fail],
  );

  const adopt = useCallback(
    ({ id, asset }: AdoptSource) => {
      release();
      if (!asset || usableAsInputDirectly(asset)) {
        setState({
          status: 'ready',
          assetId: id,
          previewUrl: asset?.thumbUrl ?? asset?.url ?? `/api/v1/media/${id}`,
          width: asset?.width,
          height: asset?.height,
          source: 'asset',
          thumbUrl: asset?.thumbUrl,
        });
        return;
      }
      // A video result: only its still frame can be an input, as a copy.
      const run = new AbortController();
      controller.current = run;
      setState({ status: 'importing', previewUrl: asset.thumbUrl ?? null });
      copyAssetAsInput({ id, thumbUrl: asset.thumbUrl }, { signal: run.signal }).then(
        (copy) => {
          if (run.signal.aborted) return;
          setState({
            status: 'ready',
            assetId: copy.id,
            previewUrl: asset.thumbUrl ?? copy.thumbUrl ?? copy.url,
            width: copy.width,
            height: copy.height,
            source: 'upload',
          });
        },
        (error: unknown) => {
          if (!run.signal.aborted) fail(error, 'import');
        },
      );
    },
    [release, fail],
  );

  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });

  const recover = useCallback(async (): Promise<string | null> => {
    const current = stateRef.current;
    if (current.status !== 'ready' || current.source !== 'asset') return null;
    try {
      const copy = await copyAssetAsInput({ id: current.assetId, thumbUrl: current.thumbUrl });
      setState({ ...current, assetId: copy.id, source: 'upload' });
      return copy.id;
    } catch (error) {
      fail(error, isApiError(error) ? 'api' : 'import');
      return null;
    }
  }, [fail]);

  const clear = useCallback(() => {
    release();
    setState(EMPTY);
  }, [release]);

  return { state, accept, adopt, recover, clear };
}
