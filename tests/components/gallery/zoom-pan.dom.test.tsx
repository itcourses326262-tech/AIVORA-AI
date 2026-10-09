import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ZoomPan } from '@/components/gallery/zoom-pan';
import { renderUi } from '../render';
import { assetDTO } from '../generations/support';

function layer() {
  return screen.getByRole('group').querySelector('img')?.parentElement as HTMLElement;
}

function mount(locale: 'en' | 'ar' = 'en') {
  renderUi(<ZoomPan asset={assetDTO({ id: 'ast_zoom' })} alt="A lone lighthouse" />, { locale });
  // Controls appear when the picture has loaded.
  fireEvent.load(screen.getByRole('img', { name: 'A lone lighthouse' }));
}

describe('ZoomPan', () => {
  it('shows the picture fitted and names the region after it', () => {
    mount();
    expect(screen.getByRole('group')).toHaveAccessibleName(/A lone lighthouse.*plus or minus/);
    expect(screen.getByRole('group')).toHaveAttribute('aria-roledescription', 'zoomable image');
    expect(layer().style.transform).toBe('translate(0px, 0px) scale(1)');
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('shows no controls until the picture has loaded, and a message when it fails', () => {
    renderUi(<ZoomPan asset={assetDTO()} alt="x" />);
    expect(screen.queryByRole('button', { name: 'Zoom in' })).not.toBeInTheDocument();
    fireEvent.error(screen.getByRole('img', { name: 'x' }));
    expect(screen.getByRole('img', { name: 'This file could not be loaded.' })).toBeInTheDocument();
  });

  it('zooms in and out with the buttons and goes back to fitted', async () => {
    const u = userEvent.setup();
    mount();
    const out = screen.getByRole('button', { name: 'Zoom out' });
    const fit = screen.getByRole('button', { name: 'Fit to screen' });
    expect(out).toBeDisabled();
    expect(fit).toBeDisabled();
    await u.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(layer().style.transform).toContain('scale(1.5)');
    expect(screen.getByText('150%')).toBeInTheDocument();
    expect(out).toBeEnabled();
    await u.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(layer().style.transform).toContain('scale(2.25)');
    await u.click(fit);
    expect(layer().style.transform).toBe('translate(0px, 0px) scale(1)');
  });

  it('stops at the largest zoom', async () => {
    const u = userEvent.setup();
    mount();
    const zoomIn = screen.getByRole('button', { name: 'Zoom in' });
    for (let i = 0; i < 8; i += 1) await u.click(zoomIn);
    expect(layer().style.transform).toContain('scale(6)');
    expect(zoomIn).toBeDisabled();
  });

  it('zooms with the keyboard: + and - change the zoom, 0 fits', async () => {
    const u = userEvent.setup();
    mount();
    screen.getByRole('group').focus();
    await u.keyboard('+');
    expect(layer().style.transform).toContain('scale(1.5)');
    await u.keyboard('=');
    expect(layer().style.transform).toContain('scale(2.25)');
    await u.keyboard('-');
    expect(layer().style.transform).toContain('scale(1.5)');
    await u.keyboard('0');
    expect(layer().style.transform).toContain('scale(1)');
  });

  it('does not use the arrow keys while fitted, so a page can use them for previous / next', async () => {
    mount();
    const stage = screen.getByRole('group');
    stage.focus();
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
      cancelable: true,
    });
    stage.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('zooms with Ctrl and the wheel (a trackpad pinch) and leaves the plain wheel to the page', () => {
    mount();
    const stage = screen.getByRole('group');
    const plain = new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true });
    stage.dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(false);
    expect(layer().style.transform).toContain('scale(1)');
    const pinch = new WheelEvent('wheel', {
      deltaY: -100,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      stage.dispatchEvent(pinch);
    });
    expect(pinch.defaultPrevented).toBe(true);
    expect(layer().style.transform).not.toContain('scale(1)');
  });

  it('uses the locale’s digits for the zoom percentage', () => {
    mount('ar');
    expect(screen.getByRole('group').textContent).toMatch(/[١٠]{3}/);
  });
});
