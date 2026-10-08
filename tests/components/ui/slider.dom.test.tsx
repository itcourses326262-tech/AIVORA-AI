import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Slider } from '@/components/ui/slider';
import { renderUi } from '../render';

const slider = () => screen.getByRole('slider');

describe('Slider', () => {
  it('exposes its range, value and spoken value', () => {
    renderUi(
      <Slider
        aria-label="Duration"
        min={3}
        max={10}
        defaultValue={5}
        formatValue={(v) => `${v} seconds`}
      />,
    );
    expect(slider()).toHaveAttribute('aria-valuemin', '3');
    expect(slider()).toHaveAttribute('aria-valuemax', '10');
    expect(slider()).toHaveAttribute('aria-valuenow', '5');
    expect(slider()).toHaveAttribute('aria-valuetext', '5 seconds');
    expect(slider()).toHaveAccessibleName('Duration');
  });

  it('keys: arrows step, Page keys jump, Home and End go to the ends, clamped', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    renderUi(
      <Slider
        aria-label="V"
        min={0}
        max={100}
        step={5}
        defaultValue={50}
        onValueChange={onValueChange}
      />,
    );
    slider().focus();
    await user.keyboard('{ArrowRight}');
    expect(slider()).toHaveAttribute('aria-valuenow', '55');
    await user.keyboard('{ArrowUp}');
    expect(slider()).toHaveAttribute('aria-valuenow', '60');
    await user.keyboard('{ArrowLeft}{ArrowDown}');
    expect(slider()).toHaveAttribute('aria-valuenow', '50');
    await user.keyboard('{PageUp}');
    expect(slider()).toHaveAttribute('aria-valuenow', '60');
    await user.keyboard('{PageDown}{PageDown}');
    expect(slider()).toHaveAttribute('aria-valuenow', '40');
    await user.keyboard('{End}');
    expect(slider()).toHaveAttribute('aria-valuenow', '100');
    await user.keyboard('{ArrowRight}');
    expect(slider()).toHaveAttribute('aria-valuenow', '100');
    await user.keyboard('{Home}');
    expect(slider()).toHaveAttribute('aria-valuenow', '0');
    expect(onValueChange).toHaveBeenLastCalledWith(0);
  });

  it('left and right follow the thumb on screen: in RTL ArrowLeft increases', async () => {
    const user = userEvent.setup();
    renderUi(<Slider aria-label="V" defaultValue={50} />, { locale: 'ar' });
    slider().focus();
    await user.keyboard('{ArrowLeft}');
    expect(slider()).toHaveAttribute('aria-valuenow', '51');
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(slider()).toHaveAttribute('aria-valuenow', '49');
    // Up and down never flip.
    await user.keyboard('{ArrowUp}');
    expect(slider()).toHaveAttribute('aria-valuenow', '50');
  });

  it('commits on key presses', async () => {
    const user = userEvent.setup();
    const onValueCommit = vi.fn();
    renderUi(<Slider aria-label="V" defaultValue={1} onValueCommit={onValueCommit} />);
    slider().focus();
    await user.keyboard('{ArrowRight}');
    expect(onValueCommit).toHaveBeenCalledWith(2);
  });

  it('is controlled by value', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    renderUi(<Slider aria-label="V" value={10} onValueChange={onValueChange} />);
    slider().focus();
    await user.keyboard('{ArrowRight}');
    expect(onValueChange).toHaveBeenCalledWith(11);
    expect(slider()).toHaveAttribute('aria-valuenow', '10');
  });

  it('ignores input and leaves the tab order when disabled', async () => {
    const user = userEvent.setup();
    renderUi(<Slider aria-label="V" defaultValue={5} disabled />);
    expect(slider()).toHaveAttribute('aria-disabled', 'true');
    expect(slider()).toHaveAttribute('tabindex', '-1');
    slider().focus();
    await user.keyboard('{ArrowRight}');
    expect(slider()).toHaveAttribute('aria-valuenow', '5');
  });

  it('snaps to the step and drops float noise', async () => {
    const user = userEvent.setup();
    renderUi(<Slider aria-label="V" min={0} max={1} step={0.1} defaultValue={0.3} />);
    slider().focus();
    await user.keyboard('{ArrowRight}');
    expect(slider()).toHaveAttribute('aria-valuenow', '0.4');
  });

  function mockTrack(track: HTMLElement, thumb: HTMLElement) {
    track.getBoundingClientRect = () =>
      ({
        left: 100,
        right: 300,
        width: 200,
        top: 0,
        bottom: 24,
        height: 24,
        x: 100,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    thumb.getBoundingClientRect = () => ({ width: 20 }) as DOMRect;
    track.setPointerCapture = vi.fn();
    track.releasePointerCapture = vi.fn();
  }

  it('maps a pointer position to a value, from the start edge (left in LTR)', () => {
    const onValueCommit = vi.fn();
    renderUi(
      <Slider aria-label="V" min={0} max={100} defaultValue={0} onValueCommit={onValueCommit} />,
    );
    const thumb = slider();
    const track = thumb.parentElement as HTMLElement;
    mockTrack(track, thumb);
    // The thumb centre travels 10px..190px of the 200px track; clientX 200 is 100px from the left edge.
    fireEvent.pointerDown(track, { clientX: 200, pointerId: 1 });
    expect(thumb).toHaveAttribute('aria-valuenow', '50');
    fireEvent.pointerMove(track, { clientX: 290, pointerId: 1 });
    expect(thumb).toHaveAttribute('aria-valuenow', '100');
    fireEvent.pointerUp(track, { clientX: 290, pointerId: 1 });
    expect(onValueCommit).toHaveBeenCalledWith(100);
    expect(thumb).toHaveFocus();
  });

  it('maps pointer positions from the right edge in RTL', () => {
    renderUi(<Slider aria-label="V" min={0} max={100} defaultValue={0} />, { locale: 'ar' });
    const thumb = slider();
    const track = thumb.parentElement as HTMLElement;
    mockTrack(track, thumb);
    // 100px from the right edge (300 - 200 = 100): the middle of the thumb's travel.
    fireEvent.pointerDown(track, { clientX: 200, pointerId: 1 });
    expect(thumb).toHaveAttribute('aria-valuenow', '50');
    fireEvent.pointerMove(track, { clientX: 110, pointerId: 1 });
    expect(thumb).toHaveAttribute('aria-valuenow', '100');
  });
});
