import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CopyButton } from '@/components/marketing/copy-button';
import { Toaster, toast } from '@/components/ui/toast';
import { renderUi } from '../render';

const writeText = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
  vi.useFakeTimers();
  writeText.mockReset();
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

afterEach(() => {
  act(() => {
    toast.dismissAll();
    vi.advanceTimersByTime(1000);
  });
  vi.useRealTimers();
});

const mount = (locale: 'ar' | 'en' = 'en') =>
  renderUi(
    <>
      <CopyButton
        text="curl -X POST x"
        label="Copy command"
        copiedLabel="Copied"
        failedLabel="Could not copy"
      />
      <Toaster />
    </>,
    { locale },
  );

describe('CopyButton', () => {
  it('puts the text on the clipboard, says so for two seconds, then goes back', async () => {
    writeText.mockResolvedValue(undefined);
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Copy command' }));
    await act(async () => {});
    expect(writeText).toHaveBeenCalledExactlyOnceWith('curl -X POST x');
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
    // The change is announced politely, once.
    expect(screen.getAllByRole('status').some((node) => node.textContent === 'Copied')).toBe(true);

    act(() => {
      vi.advanceTimersByTime(2100);
    });
    expect(screen.getByRole('button', { name: 'Copy command' })).toBeInTheDocument();
  });

  it('tells the visitor when the browser refuses, and does not claim success', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Copy command' }));
    await act(async () => {});
    expect(screen.getByRole('button', { name: 'Copy command' })).toBeInTheDocument();
    expect(screen.getByText('Could not copy')).toBeInTheDocument();
  });

  it('survives a missing clipboard API (an insecure page) the same way', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Copy command' }));
    await act(async () => {});
    expect(screen.getByText('Could not copy')).toBeInTheDocument();
  });
});
