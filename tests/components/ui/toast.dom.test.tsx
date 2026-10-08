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
    const item = screen.getByText('Reading').closest('li') as HTMLElement;
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
