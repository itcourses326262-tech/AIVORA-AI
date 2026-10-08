import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Trash2 } from 'lucide-react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IconButton } from '@/components/ui/icon-button';
import { Tooltip } from '@/components/ui/tooltip';
import { renderUi } from '../render';

afterEach(() => {
  vi.useRealTimers();
});

describe('Tooltip', () => {
  it('shows on keyboard focus right away and describes the trigger', async () => {
    const user = userEvent.setup();
    renderUi(
      <Tooltip content="Copy link">
        <button>Copy</button>
      </Tooltip>,
    );
    await user.tab();
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('Copy link');
    expect(screen.getByRole('button', { name: 'Copy' })).toHaveAccessibleDescription('Copy link');
  });

  it('hides on blur and on Escape', async () => {
    const user = userEvent.setup();
    renderUi(
      <>
        <Tooltip content="Hint">
          <button>Target</button>
        </Tooltip>
        <button>Other</button>
      </>,
    );
    await user.tab();
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    await user.tab({ shift: true });
    await user.tab();
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    await user.tab();
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('shows after a hover delay, not immediately', () => {
    vi.useFakeTimers();
    // A tooltip that closed a moment ago makes the next one open at once ("warm"): move past that.
    vi.advanceTimersByTime(1000);
    renderUi(
      <Tooltip content="Later" delay={300}>
        <button>Hover me</button>
      </Tooltip>,
    );
    const button = screen.getByRole('button', { name: 'Hover me' });
    fireEvent.pointerEnter(button, { pointerType: 'mouse' });
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(screen.getByRole('tooltip')).toHaveTextContent('Later');
  });

  it('does not open on touch hover and closes when the pointer leaves', () => {
    vi.useFakeTimers();
    renderUi(
      <Tooltip content="Mouse only" delay={0}>
        <button>Target</button>
      </Tooltip>,
    );
    const button = screen.getByRole('button', { name: 'Target' });
    fireEvent.pointerEnter(button, { pointerType: 'touch' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    fireEvent.pointerEnter(button, { pointerType: 'mouse' });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.pointerLeave(button, { pointerType: 'mouse' });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('stays open while the pointer is over the tooltip itself (hoverable content)', () => {
    vi.useFakeTimers();
    renderUi(
      <Tooltip content="Stay" delay={0}>
        <button>Target</button>
      </Tooltip>,
    );
    const button = screen.getByRole('button', { name: 'Target' });
    fireEvent.pointerEnter(button, { pointerType: 'mouse' });
    fireEvent.pointerLeave(button, { pointerType: 'mouse' });
    fireEvent.pointerEnter(screen.getByRole('tooltip'));
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });

  it('does not show when disabled', async () => {
    const user = userEvent.setup();
    renderUi(
      <Tooltip content="Nope" disabled>
        <button>Target</button>
      </Tooltip>,
    );
    await user.tab();
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('keeps the trigger own event handlers and describedby', async () => {
    const user = userEvent.setup();
    const onFocus = vi.fn();
    renderUi(
      <Tooltip content="Tip">
        <button aria-describedby="own" onFocus={onFocus}>
          Target
        </button>
      </Tooltip>,
    );
    await user.tab();
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Target' }).getAttribute('aria-describedby')).toBe(
      `own ${screen.getByRole('tooltip').id}`,
    );
  });
});

describe('IconButton', () => {
  it('is named by its label and shows it as a tooltip on focus', async () => {
    const user = userEvent.setup();
    renderUi(
      <IconButton label="Delete">
        <Trash2 />
      </IconButton>,
    );
    await user.tab();
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveFocus();
    expect(screen.getByRole('tooltip')).toHaveTextContent('Delete');
  });

  it('can drop the tooltip, and is not a submit button by default', async () => {
    const user = userEvent.setup();
    renderUi(
      <IconButton label="Close" tooltip={false}>
        <Trash2 />
      </IconButton>,
    );
    expect(screen.getByRole('button', { name: 'Close' })).toHaveAttribute('type', 'button');
    await user.tab();
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('loading ignores clicks and is announced busy', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    renderUi(
      <IconButton label="Save" loading onClick={onClick} tooltip={false}>
        <Trash2 />
      </IconButton>,
    );
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
