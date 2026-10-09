import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MediaPreview } from '@/components/generations';
import { renderUi } from '../render';
import { assetDTO } from './support';

const video = (overrides: Parameters<typeof assetDTO>[0] = {}) =>
  assetDTO({
    id: 'ast_clip',
    kind: 'video',
    mimeType: 'video/mp4',
    durationMs: 5000,
    ...overrides,
  });

const videoElement = () => document.querySelector('video') as HTMLVideoElement;
const shimmer = () => document.querySelector('.animate-shimmer');

describe('MediaPreview: a real video', () => {
  it('shows the poster of a thumbnail at once: the video is not hidden waiting for data that never comes', () => {
    renderUi(<MediaPreview asset={video()} alt="Lighthouse" aspect={16 / 9} />);
    const element = videoElement();
    // A thumbnail does not download the file, so no `loadeddata` will ever fire: the poster is
    // the picture, and nothing may hide it or sit on top of it.
    expect(element).toHaveAttribute('preload', 'none');
    expect(element).toHaveAttribute('poster', '/api/v1/media/ast_clip?variant=thumb');
    expect(element.className).not.toMatch(/opacity-0/);
    expect(shimmer()).toBeNull();
    expect(element.controls).toBe(true);
  });

  it('loads the first frame of a video without a poster, and shows it as it arrives', () => {
    renderUi(
      <MediaPreview asset={video({ thumbUrl: undefined })} alt="Lighthouse" aspect={16 / 9} />,
    );
    const element = videoElement();
    expect(element).toHaveAttribute('preload', 'metadata');
    expect(element).not.toHaveAttribute('poster');
    expect(element.className).not.toMatch(/opacity-0/);
    // Until a frame has arrived the shimmer shows through the empty video.
    expect(shimmer()).not.toBeNull();
    fireEvent.loadedData(element);
    expect(shimmer()).toBeNull();
  });

  it('opens the full view with its metadata, visible from the start', () => {
    renderUi(<MediaPreview asset={video()} alt="Lighthouse" variant="full" fit="contain" />);
    const element = videoElement();
    expect(element).toHaveAttribute('preload', 'metadata');
    expect(element.className).not.toMatch(/opacity-0/);
    expect(shimmer()).not.toBeNull();
    fireEvent.loadedData(element);
    expect(shimmer()).toBeNull();
  });

  it('replaces the video with a quiet message when it cannot be loaded', () => {
    renderUi(<MediaPreview asset={video()} alt="Lighthouse" variant="full" />);
    fireEvent.error(videoElement());
    expect(screen.getByRole('img', { name: 'This file could not be loaded.' })).toBeInTheDocument();
    expect(videoElement()).toBeNull();
  });
});
