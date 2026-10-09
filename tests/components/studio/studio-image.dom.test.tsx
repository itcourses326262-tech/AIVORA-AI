import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newId } from '@/lib/id';
import {
  apiError,
  assetDTO,
  imageFile,
  installFakeUploads,
  type FakeUpload,
} from '../generations/support';
import {
  cards,
  generateButton,
  installDomStubs,
  mountStudio,
  promptBox,
  ready,
  resetEnvironment,
} from './support';

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav, usePathname: () => '/studio' }));

let uploads: FakeUpload[];

beforeEach(() => {
  installDomStubs();
  uploads = installFakeUploads();
  nav.push.mockClear();
});
afterEach(resetEnvironment);

const fileInput = () => document.querySelector('input[type="file"]') as HTMLInputElement;
const region = () =>
  screen.getByRole('button', { name: 'Drop an image or click to upload' }).parentElement as HTMLElement;

function choose(file: File) {
  fireEvent.change(fileInput(), { target: { files: [file] } });
}

async function openImageTool(options: Parameters<typeof mountStudio>[0] = {}) {
  const mounted = mountStudio({ prefill: { tool: 'image-to-image' }, ...options });
  // On a phone the models live in the sheet; the attachment button is what shows the page is up.
  if (options.desktop === false) await screen.findByRole('button', { name: 'Add image' });
  else await ready();
  return mounted;
}

describe('Studio: the input image of image tools', () => {
  it('accepts only PNG, JPEG and WebP in the file picker', async () => {
    await openImageTool();
    expect(fileInput().accept).toBe('image/png,image/jpeg,image/webp');
  });

  it('uploads a chosen file with progress, then shows a thumbnail with its name and size', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:preview');
    URL.revokeObjectURL = vi.fn();
    await openImageTool();
    choose(imageFile('holiday.png'));

    expect(await screen.findByText('Uploading… 0%')).toBeInTheDocument();
    expect(uploads).toHaveLength(1);
    expect(uploads[0]?.url).toBe('/api/v1/uploads');
    expect((uploads[0]?.file as File).name).toBe('holiday.png');

    uploads[0]?.progress(50, 100);
    expect(await screen.findByText('Uploading… 50%')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Uploading… 50%' })).toHaveAttribute(
      'aria-valuenow',
      '50',
    );

    uploads[0]?.respond(201, { data: assetDTO({ id: 'ast_up', width: 640, height: 480 }) });
    expect(await screen.findByText('holiday.png')).toBeInTheDocument();
    expect(screen.getByText('640 × 480 px')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Your input image' })).toHaveAttribute(
      'src',
      'blob:preview',
    );
    expect(screen.getByRole('button', { name: 'Replace' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove image' })).toBeInTheDocument();
  });

  it('sends the uploaded asset as the input of the generation', async () => {
    const { api } = await openImageTool();
    choose(imageFile('holiday.png'));
    await waitFor(() => expect(uploads).toHaveLength(1));
    const asset = assetDTO({ id: newId('ast') });
    uploads[0]?.respond(201, { data: asset });
    await screen.findByText('holiday.png');
    const user = userEvent.setup();
    await user.type(promptBox(), 'Turn it into watercolor');
    await user.click(generateButton());
    await waitFor(() => expect(api.callsTo('POST', '/generations')).toHaveLength(1));
    expect(api.callsTo('POST', '/generations')[0]?.body).toMatchObject({
      tool: 'image-to-image',
      inputAssetId: asset.id,
      params: { strength: 0.6 },
    });
    await waitFor(() => expect(cards()).toHaveLength(1));
  });

  it('can cancel an upload, and remove or replace a finished one', async () => {
    await openImageTool();
    const user = userEvent.setup();
    choose(imageFile('one.png'));
    await user.click(await screen.findByRole('button', { name: 'Cancel upload' }));
    expect(uploads[0]?.aborted).toBe(true);
    expect(screen.getByRole('button', { name: 'Drop an image or click to upload' })).toBeInTheDocument();

    choose(imageFile('two.png'));
    await waitFor(() => expect(uploads).toHaveLength(2));
    uploads[1]?.respond(201, { data: assetDTO() });
    await screen.findByText('two.png');
    await user.click(screen.getByRole('button', { name: 'Remove image' }));
    expect(screen.getByRole('button', { name: 'Drop an image or click to upload' })).toBeInTheDocument();

    choose(imageFile('three.png'));
    await waitFor(() => expect(uploads).toHaveLength(3));
    uploads[2]?.respond(201, { data: assetDTO({ id: 'ast_three' }) });
    await screen.findByText('three.png');
    choose(imageFile('four.webp', 'image/webp'));
    await waitFor(() => expect(uploads).toHaveLength(4));
    uploads[3]?.respond(201, { data: assetDTO({ id: 'ast_four' }) });
    expect(await screen.findByText('four.webp')).toBeInTheDocument();
  });

  it('refuses a file of the wrong type before sending anything', async () => {
    await openImageTool();
    choose(imageFile('notes.txt', 'text/plain'));
    expect(
      await screen.findByText('Only PNG, JPEG or WebP images are supported.'),
    ).toBeInTheDocument();
    expect(uploads).toHaveLength(0);
    // A GIF is not an input either.
    choose(imageFile('anim.gif', 'image/gif'));
    expect(
      await screen.findByText('Only PNG, JPEG or WebP images are supported.'),
    ).toBeInTheDocument();
    expect(uploads).toHaveLength(0);
  });

  it('refuses a file over 10 MB before sending anything', async () => {
    await openImageTool();
    choose(imageFile('big.png', 'image/png', 10 * 1024 * 1024 + 1));
    expect(
      await screen.findByText('This image is larger than 10 MB. Choose a smaller one.'),
    ).toBeInTheDocument();
    expect(uploads).toHaveLength(0);
    // Exactly 10 MB is fine.
    choose(imageFile('edge.png', 'image/png', 10 * 1024 * 1024));
    await waitFor(() => expect(uploads).toHaveLength(1));
    expect(screen.queryByText(/larger than/)).not.toBeInTheDocument();
  });

  it('says what went wrong when the server refuses the upload, or the connection drops', async () => {
    await openImageTool();
    choose(imageFile('a.png'));
    await waitFor(() => expect(uploads).toHaveLength(1));
    uploads[0]?.respond(413, { error: { code: 'payload_too_large', message: 'x' } });
    expect(await screen.findByText('The file or request is too large.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Drop an image or click to upload' })).toBeInTheDocument();

    choose(imageFile('b.png'));
    await waitFor(() => expect(uploads).toHaveLength(2));
    uploads[1]?.fail();
    expect(
      await screen.findByText("We can't reach the server. Check your connection and try again."),
    ).toBeInTheDocument();

    choose(imageFile('c.png'));
    await waitFor(() => expect(uploads).toHaveLength(3));
    uploads[2]?.respond(415, { error: { code: 'unsupported_media_type', message: 'x' } });
    expect(await screen.findByText("This file type isn't supported.")).toBeInTheDocument();
  });

  it('asks for an image when Generate is pressed without one, and for patience while it uploads', async () => {
    const { api } = await openImageTool();
    const user = userEvent.setup();
    await user.type(promptBox(), 'Turn it into watercolor');
    await user.click(generateButton());
    expect(await screen.findByText('Add an image to continue.')).toBeInTheDocument();
    expect(api.callsTo('POST', '/generations')).toHaveLength(0);

    choose(imageFile('a.png'));
    await screen.findByText('Uploading… 0%');
    await user.click(generateButton());
    expect(await screen.findByText('Wait for the image to finish uploading.')).toBeInTheDocument();
    expect(api.callsTo('POST', '/generations')).toHaveLength(0);
  });

  it('takes a picture pasted anywhere on the page, but leaves pasted text to the prompt', async () => {
    await openImageTool();
    const text = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(text, 'clipboardData', { value: { files: [] } });
    document.dispatchEvent(text);
    expect(text.defaultPrevented).toBe(false);
    expect(uploads).toHaveLength(0);

    const picture = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(picture, 'clipboardData', { value: { files: [imageFile('shot.png')] } });
    document.dispatchEvent(picture);
    expect(picture.defaultPrevented).toBe(true);
    await waitFor(() => expect(uploads).toHaveLength(1));
    expect((uploads[0]?.file as File).name).toBe('shot.png');
  });

  it('takes a dropped picture, and shows where to drop while dragging', async () => {
    await openImageTool();
    const zone = region();
    fireEvent.dragEnter(zone, { dataTransfer: { files: [] } });
    expect(screen.getByText('Drop to use this image')).toBeInTheDocument();
    fireEvent.dragLeave(zone);
    expect(screen.getByText('Drop an image or click to upload')).toBeInTheDocument();

    fireEvent.drop(zone, { dataTransfer: { files: [imageFile('dropped.jpg', 'image/jpeg')] } });
    await waitFor(() => expect(uploads).toHaveLength(1));
    expect((uploads[0]?.file as File).name).toBe('dropped.jpg');
  });

  it('says so when what is dropped is not a picture, and sends nothing', async () => {
    await openImageTool();
    fireEvent.drop(region(), { dataTransfer: { files: [imageFile('a.txt', 'text/plain')] } });
    expect(
      await screen.findByText('Only PNG, JPEG or WebP images are supported.'),
    ).toBeInTheDocument();
    expect(uploads).toHaveLength(0);
    // With a picture among the files, the picture is the one that counts.
    fireEvent.drop(region(), {
      dataTransfer: { files: [imageFile('a.txt', 'text/plain'), imageFile('b.png')] },
    });
    await waitFor(() => expect(uploads).toHaveLength(1));
    expect((uploads[0]?.file as File).name).toBe('b.png');
  });

  it('keeps the picture when switching between the two image tools, and when coming back from a text tool', async () => {
    await openImageTool();
    choose(imageFile('keep.png'));
    await waitFor(() => expect(uploads).toHaveLength(1));
    uploads[0]?.respond(201, { data: assetDTO({ id: 'ast_keep' }) });
    await screen.findByText('keep.png');
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Image to video' }));
    expect(screen.getByText('keep.png')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Text to video' }));
    expect(screen.queryByText('keep.png')).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Image to image' }));
    expect(screen.getByText('keep.png')).toBeInTheDocument();
  });

  it('does not upload when a text tool is open: nothing listens for pastes there', async () => {
    mountStudio();
    await ready();
    const picture = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(picture, 'clipboardData', { value: { files: [imageFile()] } });
    document.dispatchEvent(picture);
    expect(picture.defaultPrevented).toBe(false);
    expect(uploads).toHaveLength(0);
  });
});

describe('Studio: a refused file leaves the picture that is there alone', () => {
  const pdf = () => imageFile('notes.pdf', 'application/pdf');
  const typeError = 'Only PNG, JPEG or WebP images are supported.';

  async function attach(name = 'keep.png', id = 'ast_keep') {
    choose(imageFile(name));
    await waitFor(() => expect(uploads.length).toBeGreaterThan(0));
    uploads[uploads.length - 1]?.respond(201, { data: assetDTO({ id }) });
    await screen.findByText(name);
  }

  it('keeps a ready picture, says why the other file was refused, and still sends the picture', async () => {
    const { api } = await openImageTool();
    await attach();
    choose(pdf());
    expect(await screen.findByText(typeError)).toBeInTheDocument();
    // Still there, still replaceable, and nothing was sent for the refused file.
    expect(screen.getByText('keep.png')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Replace' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove image' })).toBeInTheDocument();
    expect(uploads).toHaveLength(1);

    const user = userEvent.setup();
    await user.type(promptBox(), 'Turn it into watercolor');
    await user.click(generateButton());
    await waitFor(() => expect(api.callsTo('POST', '/generations')).toHaveLength(1));
    expect(api.callsTo('POST', '/generations')[0]?.body).toMatchObject({
      inputAssetId: 'ast_keep',
    });
  });

  it('lets an upload in progress finish when a wrong file is dropped on top of it', async () => {
    await openImageTool();
    choose(imageFile('slow.png'));
    await screen.findByText('Uploading… 0%');
    choose(pdf());
    expect(await screen.findByText(typeError)).toBeInTheDocument();
    // The screen still tells the truth: an upload is running, and nothing aborted it.
    expect(screen.getByText('Uploading… 0%')).toBeInTheDocument();
    expect(uploads[0]?.aborted).toBe(false);

    uploads[0]?.respond(201, { data: assetDTO({ id: 'ast_slow' }) });
    expect(await screen.findByText('slow.png')).toBeInTheDocument();
  });

  it('forgets the refusal once a good file, a removal or a replacement follows', async () => {
    await openImageTool();
    await attach();
    const user = userEvent.setup();
    choose(pdf());
    await screen.findByText(typeError);
    await user.click(screen.getByRole('button', { name: 'Remove image' }));
    expect(screen.queryByText(typeError)).not.toBeInTheDocument();

    choose(pdf());
    await screen.findByText(typeError);
    choose(imageFile('next.png'));
    await waitFor(() => expect(screen.queryByText(typeError)).not.toBeInTheDocument());
  });

  it('does the same on a phone, where the picture is a chip', async () => {
    await openImageTool({ desktop: false });
    await attach('phone.png', 'ast_phone');
    choose(pdf());
    expect(await screen.findByText(typeError)).toBeInTheDocument();
    expect(screen.getByText('phone.png')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove image' })).toBeInTheDocument();
  });
});

describe('Studio: an input image from a link (?input=)', () => {
  const asset = newId('ast');

  it('uses the asset as it is, without uploading anything', async () => {
    const { api } = await openImageTool({
      prefill: { tool: 'image-to-image', inputAssetId: asset },
    });
    expect(await screen.findByRole('img', { name: 'Your input image' })).toHaveAttribute(
      'src',
      `/api/v1/media/${asset}`,
    );
    expect(uploads).toHaveLength(0);
    const user = userEvent.setup();
    await user.type(promptBox(), 'Make it snowy');
    await user.click(generateButton());
    await waitFor(() => expect(api.callsTo('POST', '/generations')).toHaveLength(1));
    expect(api.callsTo('POST', '/generations')[0]?.body).toMatchObject({ inputAssetId: asset });
  });

  it('opens image-to-image for a link that only names an image', async () => {
    mountStudio({ prefill: { tool: 'image-to-image', inputAssetId: asset } });
    await ready();
    expect(screen.getByRole('tab', { name: 'Image to image' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('copies the picture as a new input when the engine refuses the asset, and sends the copy', async () => {
    let refused = false;
    const copy = assetDTO({ id: newId('ast') });
    const { api } = await openImageTool({
      prefill: { tool: 'image-to-image', inputAssetId: asset },
      prepare: (fake) =>
        fake.intercept((call) => {
          if (call.method === 'POST' && call.path === '/generations' && !refused) {
            refused = true;
            return apiError(404, 'not_found', { path: 'inputAssetId' });
          }
          if (call.method === 'GET' && call.path.startsWith(`/media/${asset}`)) {
            return new Response(new Uint8Array([1, 2, 3]), {
              headers: { 'content-type': 'image/webp' },
            });
          }
          return undefined;
        }),
    });
    const user = userEvent.setup();
    await user.type(promptBox(), 'Make it snowy');
    await user.click(generateButton());
    await waitFor(() => expect(uploads).toHaveLength(1));
    uploads[0]?.respond(201, { data: copy });
    await waitFor(() => expect(api.callsTo('POST', '/generations')).toHaveLength(2));
    expect(
      (api.callsTo('POST', '/generations')[0]?.body as { inputAssetId: string }).inputAssetId,
    ).toBe(asset);
    expect(
      (api.callsTo('POST', '/generations')[1]?.body as { inputAssetId: string }).inputAssetId,
    ).toBe(copy.id);
    await waitFor(() => expect(cards()).toHaveLength(1));
  });

  it('shows why when the picture cannot be copied either', async () => {
    await openImageTool({
      prefill: { tool: 'image-to-image', inputAssetId: asset },
      prepare: (fake) =>
        fake.intercept((call) =>
          call.method === 'POST' && call.path === '/generations'
            ? apiError(404, 'not_found', { path: 'inputAssetId' })
            : undefined,
        ),
    });
    const user = userEvent.setup();
    await user.type(promptBox(), 'Make it snowy');
    await user.click(generateButton());
    expect(
      await screen.findAllByText("We couldn't find what you were looking for."),
    ).not.toHaveLength(0);
    expect(cards()).toHaveLength(0);
  });
});

describe('Studio: the input image on a phone', () => {
  it('is an "Add image" attachment above the prompt, with its chip, progress and errors', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:chip');
    URL.revokeObjectURL = vi.fn();
    await openImageTool({ desktop: false });
    const user = userEvent.setup();
    expect(screen.queryByText('Input image')).not.toBeInTheDocument();

    choose(imageFile('notes.txt', 'text/plain'));
    expect(
      await screen.findByText('Only PNG, JPEG or WebP images are supported.'),
    ).toBeInTheDocument();

    choose(imageFile('phone.png'));
    expect(await screen.findByText('Uploading… 0%')).toBeInTheDocument();
    uploads[0]?.progress(30, 100);
    expect(await screen.findByText('Uploading… 30%')).toBeInTheDocument();
    uploads[0]?.respond(201, { data: assetDTO() });
    expect(await screen.findByText('phone.png')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Your input image' })).toHaveAttribute(
      'src',
      'blob:chip',
    );
    await user.click(screen.getByRole('button', { name: 'Remove image' }));
    expect(screen.getByRole('button', { name: 'Add image' })).toBeInTheDocument();
  });
});
