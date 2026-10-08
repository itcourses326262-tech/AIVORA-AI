/**
 * Uploading the input image of image-to-image and image-to-video: the checks the browser can make
 * before sending (type and size, the server checks them again), and a `POST /api/v1/uploads` that
 * reports progress. `fetch` cannot report upload progress, so this one call uses XMLHttpRequest.
 */
import { ApiError } from '@/lib/api-client';
import type { AssetDTO } from '@/lib/api-types';
import { codeForStatus, isErrorCode } from '@/lib/errors';
import { isRecord, safeJson } from '@/lib/utils';

export const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

/** The server's default `MAX_UPLOAD_MB`; a larger file would be refused after the whole upload. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export type ImageFileProblem = 'type' | 'size';

export function isAllowedImageType(type: string): type is AllowedImageType {
  return (ALLOWED_IMAGE_TYPES as readonly string[]).includes(type);
}

/** What is wrong with a file before it is sent, or null when it may be uploaded. */
export function imageFileProblem(file: Pick<File, 'type' | 'size'>): ImageFileProblem | null {
  if (!isAllowedImageType(file.type)) return 'type';
  if (file.size > MAX_UPLOAD_BYTES) return 'size';
  return null;
}

export interface UploadImageOptions {
  /** 0 to 1 while the file is on its way. */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

function abortError(): DOMException {
  return new DOMException('The upload was canceled', 'AbortError');
}

function errorFromResponse(status: number, text: string, requestId: string | null): ApiError {
  const body = safeJson(text);
  if (isRecord(body) && isRecord(body.error) && typeof body.error.message === 'string') {
    const { code, message, details } = body.error;
    return new ApiError(
      isErrorCode(code) ? code : codeForStatus(status),
      status,
      message,
      details,
      requestId ?? undefined,
    );
  }
  return new ApiError(
    codeForStatus(status),
    status,
    `Request failed with status ${status}`,
    undefined,
    requestId ?? undefined,
  );
}

/**
 * Sends one image to `/api/v1/uploads`. Resolves to the stored input asset; rejects with an
 * `ApiError` (`network_error` when the connection drops) or an `AbortError` when `signal` aborts.
 */
export function uploadImage(file: Blob, options: UploadImageOptions = {}): Promise<AssetDTO> {
  const { onProgress, signal } = options;
  return new Promise<AssetDTO>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const request = new XMLHttpRequest();
    const form = new FormData();
    form.append('file', file, file instanceof File ? file.name : 'image');

    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    const onAbort = () => {
      request.abort();
      cleanup();
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    request.open('POST', '/api/v1/uploads');
    request.setRequestHeader('Accept', 'application/json');
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress?.(event.loaded / event.total);
    };
    request.onerror = () => {
      cleanup();
      reject(new ApiError('network_error', 0, 'Network request failed'));
    };
    request.onload = () => {
      cleanup();
      const text = request.responseText;
      if (request.status < 200 || request.status >= 300) {
        reject(errorFromResponse(request.status, text, request.getResponseHeader('x-request-id')));
        return;
      }
      const body = safeJson(text);
      if (isRecord(body) && isRecord(body.data) && typeof body.data.id === 'string') {
        onProgress?.(1);
        resolve(body.data as unknown as AssetDTO);
        return;
      }
      reject(
        new ApiError(
          'invalid_response',
          request.status,
          'The response is missing its data envelope',
        ),
      );
    };
    request.send(form);
  });
}
