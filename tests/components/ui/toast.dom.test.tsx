import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Toaster, toast, useToast } from '@/components/ui/toast';
import { renderUi } from '../render';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  act(() => {
    toast.dismissAll();
    vi.advanceTimersByTime(1000);
  });
  vi.useRealTimers();
});

const polite = () => screen.getByRole('status', { name: 'Notifications' });
const assertive = () => screen.getByRole('alert');

describe('toast', () => {
  it('renders two live regions up front: polite for status, assertive for errors', () => {
    renderUi(<Toaster />);
    expect(polite()).toHaveAttribute('aria-live', 'polite');
    expect(assertive()).toHaveAttribute('aria-live', 'assertive');
  });

  it('puts info, success and warning in the polite region and errors in the assertive one', () => {
    renderUi(<Toaster />);
    act(() => {
      toast.success('Saved');
      toast.warning('Low credits');
      toast.info('Started');
      toast.error('Failed', { description: 'Try again' });
    });
    expect(within(polite()).getByText('Saved')).toBeInTheDocument();
    expect(within(polite()).getByText('Low credits')).toBeInTheDocument();
    expect(within(polite()).getByText('Started')).toBeInTheDocument();
    expect(within(assertive()).getByText('Failed')).toBeInTheDocument();
    expect(within(assertive()).getByText('Try again')).toBeInTheDocument();
  });

  it('closes itself after its duration', () => {
    renderUi(<Toaster />);
    act(() => {
      toast.success('Saved', { duration: 3000 });
    });
    act(() => {
      vi.advanceTimersByTime(2900);
    });
    expect(screen.getByText('Saved')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
  });

  it('errors stay longer than successes by default, and Infinity stays until dismissed', () => {
    renderUi(<Toaster />);
    act(() => {
      toast.success('Quick');
      toast.error('Slow');
      toast.info('Sticky', { duration: Infinity });
    });
    act(() => {
      vi.advanceTimersByTime(4500);
    });
    expect(screen.queryByText('Quick')).not.toBeInTheDocument();
    expect(screen.getByText('Slow')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.queryByText('Slow')).not.toBeInTheDocument();
    expect(screen.getByText('Sticky')).toBeInTheDocument();
  });

  it('pauses while hovered and resumes with what was left', () => {
    renderUi(<Toaster />);
    act(() => {
      toast.info('Reading', { duration: 4000 });
    });
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    const item = screen.getByText('Reading').closest('[data-variant]') as HTMLElement;
    fireEvent.pointerEnter(item);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText('Reading')).toBeInTheDocument();
    fireEvent.pointerLeave(item);
    act(() => {
      vi.advanceTimersByTime(900);
    });
    expect(screen.getByText('Reading')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(300); // 100ms of countdown left, then the exit animation
    });
    expect(screen.queryByText('Reading')).not.toBeInTheDocument();
  });

  it('pauses while keyboard focus is inside the toast', () => {
    renderUi(<Toaster />);
    act(() => {
      toast.info('Focusable', { duration: 2000, action: { label: 'Undo', onClick: () => {} } });
    });
    const undo = screen.getByRole('button', { name: 'Undo' });
    act(() => {
      undo.focus();
    });
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByText('Focusable')).toBeInTheDocument();
    act(() => {
      undo.blur();
    });
    act(() => {
      vi.advanceTimersByTime(2500);
    });
    expect(screen.queryByText('Focusable')).not.toBeInTheDocument();
  });

  it('has a localized dismiss button', () => {
    renderUi(<Toaster />, { locale: 'ar' });
    act(() => {
      toast.success('تم الحفظ');
    });
    fireEvent.click(screen.getByRole('button', { name: 'إخفاء الإشعار' }));
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.queryByText('تم الحفظ')).not.toBeInTheDocument();
  });

  it('runs the action and then closes the toast', () => {
    const onClick = vi.fn();
    renderUi(<Toaster />);
    act(() => {
      toast.warning('Low', { action: { label: 'Top up', onClick } });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Top up' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.queryByText('Low')).not.toBeInTheDocument();
  });

  it('reusing an id replaces the toast, even while the old one is closing', () => {
    renderUi(<Toaster />);
    act(() => {
      toast.info('First', { id: 'job' });
      toast.dismiss('job');
      toast.info('Second', { id: 'job' });
      vi.advanceTimersByTime(400);
    });
    expect(screen.queryByText('First')).not.toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
  });

  it('a progress toast that turns into its result keeps the result for its whole duration', () => {
    renderUi(<Toaster />);
    act(() => {
      toast({ id: 'gen', title: 'Working', duration: Infinity });
    });
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getByText('Working')).toBeInTheDocument();
    act(() => {
      toast({ id: 'gen', title: 'Done', variant: 'success', duration: 4000 });
    });
    expect(screen.queryByText('Working')).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(3500);
    });
    expect(screen.getByText('Done')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(800); // 4000ms of countdown, then the exit animation
    });
    expect(screen.queryByText('Done')).not.toBeInTheDocument();
  });

  it('a replacement raised near the end of the old life gets its full duration back', () => {
    renderUi(<Toaster />);
    act(() => {
      toast.info('First', { id: 'job', duration: 5000 });
    });
    act(() => {
      vi.advanceTimersByTime(4900);
    });
    act(() => {
      toast.info('Second', { id: 'job', duration: 5000 });
    });
    act(() => {
      vi.advanceTimersByTime(4500);
    });
    expect(screen.getByText('Second')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(screen.queryByText('Second')).not.toBeInTheDocument();
  });

  it('a replacement of a toast being read (paused) restarts the countdown when the pointer leaves', () => {
    renderUi(<Toaster />);
    act(() => {
      toast.info('Reading', { id: 'job', duration: 4000 });
    });
    act(() => {
      vi.advanceTimersByTime(3500);
    });
    fireEvent.pointerEnter(screen.getByText('Reading').closest('[data-variant]') as HTMLElement);
    act(() => {
      toast.info('Updated', { id: 'job', duration: 4000 });
    });
    const item = screen.getByText('Updated').closest('[data-variant]') as HTMLElement;
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText('Updated')).toBeInTheDocument();
    fireEvent.pointerLeave(item);
    act(() => {
      vi.advanceTimersByTime(3500);
    });
    expect(screen.getByText('Updated')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(screen.queryByText('Updated')).not.toBeInTheDocument();
  });

  it('a replaced toast keeps its place in the stack', () => {
    renderUi(<Toaster />);
    act(() => {
      toast.info('Upload', { id: 'upload', duration: Infinity });
      toast.info('Other', { duration: Infinity });
      toast.success('Uploaded', { id: 'upload', duration: Infinity });
    });
    const titles = Array.from(polite().querySelectorAll('[data-variant] p:first-of-type')).map(
      (title) => title.textContent,
    );
    expect(titles).toEqual(['Uploaded', 'Other']);
  });

  it('keeps the live regions valid ARIA: plain containers, no list roles replaced by a live role', () => {
    renderUi(<Toaster />);
    act(() => {
      toast.info('One');
      toast.error('Two');
    });
    for (const region of [polite(), assertive()]) {
      expect(region.tagName).toBe('DIV');
      expect(region.querySelector('[data-variant]')?.parentElement).toBe(region);
    }
    expect(document.querySelector('ol, ul, li, [role="listitem"]')).toBeNull();
  });

  it('keeps at most four toasts, dropping the oldest', () => {
    renderUi(<Toaster />);
    act(() => {
      for (let n = 1; n <= 6; n += 1) toast.info(`Toast ${n}`, { duration: Infinity });
    });
    expect(screen.queryByText('Toast 2')).not.toBeInTheDocument();
    expect(screen.getByText('Toast 3')).toBeInTheDocument();
    expect(screen.getByText('Toast 6')).toBeInTheDocument();
  });

  it('is exempt from the inert background of a modal and useToast returns the same api', () => {
    renderUi(<Toaster />);
    expect(useToast()).toBe(toast);
    expect(document.querySelector('[data-inert-exempt]')).toBeInTheDocument();
  });
});
