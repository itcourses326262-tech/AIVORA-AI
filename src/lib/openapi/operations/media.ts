import { MEDIA_RATE_LIMIT } from '@/app/api/v1/media/rate-limit';
import { UPLOAD_RATE_LIMIT } from '@/app/api/v1/uploads/rate-limit';
import { ref } from '../components';
import { IDS, inputAssetExample } from '../examples';
import {
  data,
  empty,
  failure,
  rateLimit,
  rateLimited,
  unauthorized,
  validationFailed,
  type EndpointSpec,
  type ParamSpec,
  type ResponseSpec,
} from '../operation';
import { idPathParam } from './common';

export const MEDIA_TAG = 'Uploads and media';

const assetIdParam = idPathParam(
  'assetId',
  'ast',
  'The asset id, from `outputs[].id`, `input.id` or an upload.',
  IDS.asset,
);

const mediaParams: ParamSpec[] = [
  assetIdParam,
  {
    name: 'variant',
    in: 'query',
    description: '`thumb` returns the 512 px WebP thumbnail instead of the original.',
    schema: { type: 'string', enum: ['thumb'] },
  },
  {
    name: 'download',
    in: 'query',
    description: '`1` or `true` makes the browser save the file instead of showing it.',
    schema: { type: 'string', enum: ['1', 'true', '0', 'false'] },
  },
  {
    name: 'Range',
    in: 'header',
    description:
      'A single byte range such as `bytes=0-1023`, for seeking in videos. Other forms are ignored and the whole file is sent.',
    schema: { type: 'string' },
    example: 'bytes=0-1023',
  },
];

const FILE = { type: 'string', format: 'binary' } as const;

function mediaResponses(withBody: boolean): ResponseSpec[] {
  const body = (description: string, status: number): ResponseSpec => ({
    status,
    description,
    ...(withBody
      ? { body: { kind: 'raw' as const, contentTypes: ['image/*', 'video/*'], schema: FILE } }
      : {}),
  });
  return [
    body(
      'The file. `ETag` and `Cache-Control` are set: private for the owner, public for shared results.',
      200,
    ),
    body('The requested byte range (`Content-Range` says which).', 206),
    empty(304, 'Not modified: the `If-None-Match` ETag still matches.'),
    failure(
      'not_found',
      'No such asset, or it is not visible to you. Other accounts’ assets and unknown ids look the same.',
    ),
    failure('bad_request', 'The range cannot be satisfied (`Content-Range: bytes */size`).', {
      status: 416,
    }),
    validationFailed('`variant` is not `thumb`.', [
      { path: 'variant', message: 'Invalid option: expected "thumb"' },
    ]),
    rateLimited(),
  ];
}

export const mediaEndpoints: EndpointSpec[] = [
  {
    operationId: 'uploadImage',
    tag: MEDIA_TAG,
    method: 'post',
    path: '/uploads',
    summary: 'Upload an image',
    description:
      'Uploads the input image of an image-to-image or image-to-video generation. Send `multipart/form-data` with exactly one `file` field: PNG, JPEG or WebP, at most 10 MB by default. The image is checked, rotated by its EXIF orientation, stripped of metadata and scaled down to 4096 px. Use the returned `id` as `inputAssetId`.',
    access: 'any',
    limits: [rateLimit(UPLOAD_RATE_LIMIT, 'any')],
    request: {
      description: 'One image file.',
      contentType: 'multipart/form-data',
      schema: ref('UploadRequest'),
      example: { file: '(binary)' },
    },
    responses: [
      data(201, 'The stored image.', ref('Asset'), inputAssetExample),
      failure('bad_request', 'The multipart body is malformed, or the file is not a usable image.'),
      unauthorized(),
      failure('forbidden', 'A cookie-authenticated request without a matching `Origin` header.'),
      failure('payload_too_large', 'The file is larger than the limit.'),
      failure('unsupported_media_type', 'Not `multipart/form-data`, or not a PNG, JPEG or WebP.'),
      validationFailed('There is not exactly one `file` field.', [
        { path: 'file', message: 'Send exactly one file in the "file" field' },
      ]),
      rateLimited(),
    ],
  },
  {
    operationId: 'getMedia',
    tag: MEDIA_TAG,
    method: 'get',
    path: '/media/{assetId}',
    summary: 'Download a file',
    description:
      'The image or video itself. You see your own assets; anyone sees the results of generations their owner made public. Send the same credentials you use for the API. Videos support `Range` requests. Demo videos are animated GIFs.',
    access: 'optional',
    limits: [rateLimit(MEDIA_RATE_LIMIT, 'optional')],
    curl: { auth: true, output: '-OJ', query: { download: 1 } },
    params: mediaParams,
    responses: mediaResponses(true),
  },
  {
    operationId: 'headMedia',
    tag: MEDIA_TAG,
    method: 'head',
    path: '/media/{assetId}',
    summary: 'Inspect a file',
    description: 'The headers of `GET /media/{assetId}` without the body: size, type and ETag.',
    access: 'optional',
    limits: [rateLimit(MEDIA_RATE_LIMIT, 'optional')],
    curl: { auth: true },
    params: mediaParams,
    responses: mediaResponses(false),
  },
];
