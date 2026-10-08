import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Dialog } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Sheet } from '@/components/ui/sheet';
import { I18nProvider } from '@/lib/i18n/client';
import { renderUi } from '../render';

function Harness({
  dismissible,
  role,
  onClose,
}: {
  dismissible?: boolean;
  role?: 'dialog' | 'alertdialog';
  onClose?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const change = (next: boolean) => {
    setOpen(next);
    if (!next) onClose?.();
  };
  return (
    <>
      <button onClick={() => setOpen(true)}>Open</button>
      <button>Other page control</button>
      <Dialog
        open={open}
        onOpenChange={change}
        title="Share"
        description="Anyone with the link"
        dismissible={dismissible}
        role={role}
        footer={<button onClick={() => change(false)}>Done</button>}
      >
        <label>
          Link
          <input />
        </label>
        <a href="#x">More</a>
      </Dialog>
    </>
  );
}

const openDialog = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'Open' }));
  return screen.getByRole('dialog', { name: 'Share' });
};

const waitUnmounted = () =>
  waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

describe('Dialog', () => {
  it('is a modal dialog named by its title and described by its description', async () => {
    const user = userEvent.setup();
    renderUi(<Harness />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const dialog = await openDialog(user);
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription('Anyone with the link');
    expect(screen.getByRole('heading', { name: 'Share' })).toBeInTheDocument();
  });

  it('moves focus to the first control (not the close button) and traps Tab inside', async () => {
    const user = userEvent.setup();
    renderUi(<Harness />);
    const dialog = await openDialog(user);
    const input = screen.getByRole('textbox', { name: 'Link' });
    expect(input).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('link', { name: 'More' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Done' })).toHaveFocus();
    await user.tab(); // wraps to the first tabbable inside: the close button in the header
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Done' })).toHaveFocus();
  });

  it('makes the page behind inert and locks scrolling while open, and restores both', async () => {
    const user = userEvent.setup();
    const { container } = renderUi(<Harness />);
    expect(document.documentElement.style.overflow).toBe('');
    await openDialog(user);
    expect(container).toHaveAttribute('inert');
    expect(document.documentElement.style.overflow).toBe('hidden');
    await user.keyboard('{Escape}');
    await waitUnmounted();
    expect(container).not.toHaveAttribute('inert');
    expect(document.documentElement.style.overflow).toBe('');
  });

  it('closes on Escape and returns focus to the control that opened it', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderUi(<Harness onClose={onClose} />);
    await openDialog(user);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    await waitUnmounted();
    expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus();
  });

  it('closes from the close button and from a click on the backdrop, not from a click inside', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderUi(<Harness onClose={onClose} />);
    let dialog = await openDialog(user);
    await user.click(screen.getByRole('textbox', { name: 'Link' }));
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await waitUnmounted();

    dialog = await openDialog(user);
    const backdrop = dialog.parentElement as HTMLElement;
    fireEvent.pointerDown(backdrop);
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('a drag that starts inside and ends on the backdrop does not close it', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderUi(<Harness onClose={onClose} />);
    const dialog = await openDialog(user);
    fireEvent.pointerDown(dialog);
    fireEvent.click(dialog.parentElement as HTMLElement);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('dismissible={false} ignores Escape and the backdrop but still has explicit buttons', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderUi(<Harness dismissible={false} role="alertdialog" onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Share' });
    await user.keyboard('{Escape}');
    const backdrop = dialog.parentElement as HTMLElement;
    fireEvent.pointerDown(backdrop);
    fireEvent.click(backdrop);
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a menu opened inside the dialog closes on its own Escape without closing the dialog', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    function WithMenu() {
      return (
        <Dialog open onOpenChange={onClose} title="Share">
          <DropdownMenu trigger={<button>More</button>}>
            <DropdownMenuItem>Option</DropdownMenuItem>
          </DropdownMenu>
        </Dialog>
      );
    }
    renderUi(<WithMenu />);
    await user.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledWith(false);
  });

  it('keeps the title for screen readers only with hideTitle', () => {
    renderUi(<Dialog open onOpenChange={() => {}} title="Hidden title" hideTitle />);
    expect(screen.getByRole('dialog', { name: 'Hidden title' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Hidden title' })).toHaveClass('sr-only');
  });

  it('localizes the close button', () => {
    renderUi(<Dialog open onOpenChange={() => {}} title="مشاركة" />, { locale: 'ar' });
    expect(screen.getByRole('button', { name: 'إغلاق' })).toBeInTheDocument();
  });

  it('stays mounted briefly after closing (data-state="closed") so the exit animation can play', async () => {
    const user = userEvent.setup();
    renderUi(<Harness />);
    await openDialog(user);
    expect(screen.getByRole('dialog')).toHaveAttribute('data-state', 'open');
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toHaveAttribute('data-state', 'closed');
    await waitUnmounted();
  });
});

describe('Sheet', () => {
  it.each([
    ['start', 'start-0'],
    ['end', 'end-0'],
    ['bottom', 'bottom-0'],
  ] as const)('attaches to the %s edge with logical positioning', (side, expected) => {
    renderUi(<Sheet open onOpenChange={() => {}} title="Menu" side={side} />);
    const sheet = screen.getByRole('dialog', { name: 'Menu' });
    expect(sheet).toHaveClass(expected);
    expect(sheet.className).not.toMatch(/(?:^|\s)(?:left|right)-/);
  });

  it('behaves as a modal: Escape closes, aria-modal is set', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderUi(<Sheet open onOpenChange={onOpenChange} title="Menu" />);
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    await user.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

/** A detail sheet with a confirmation dialog opened from it, as in "delete this generation?". */
function Stacked({ confirmDismissible = true }: { confirmDismissible?: boolean }) {
  const [sheet, setSheet] = useState(true);
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <Sheet open={sheet} onOpenChange={setSheet} title="Details">
        <button onClick={() => setConfirm(true)}>Delete</button>
      </Sheet>
      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        role="alertdialog"
        dismissible={confirmDismissible}
        title="Delete it?"
        footer={<button onClick={() => setConfirm(false)}>Keep</button>}
      >
        <button>Really delete</button>
      </Dialog>
      <output data-testid="state">
        {sheet ? 'sheet' : 'no-sheet'}-{confirm ? 'confirm' : 'no-confirm'}
      </output>
    </>
  );
}

const state = () => screen.getByTestId('state').textContent;

describe('stacked modals', () => {
  it('Escape closes only the modal on top, then the one below on the next press', async () => {
    const user = userEvent.setup();
    renderUi(<Stacked />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(state()).toBe('sheet-confirm');
    await user.keyboard('{Escape}');
    expect(state()).toBe('sheet-no-confirm');
    await user.keyboard('{Escape}');
    expect(state()).toBe('no-sheet-no-confirm');
  });

  it('a modal that cannot be dismissed on top protects itself and the modal below from Escape', async () => {
    const user = userEvent.setup();
    renderUi(<Stacked confirmDismissible={false} />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.keyboard('{Escape}');
    expect(state()).toBe('sheet-confirm');
    expect(screen.getByRole('alertdialog', { name: 'Delete it?' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Keep' }));
    expect(state()).toBe('sheet-no-confirm');
    await user.keyboard('{Escape}');
    expect(state()).toBe('no-sheet-no-confirm');
  });

  it('Tab stays inside the top modal while the one below is inert, and the page stays locked until both close', async () => {
    const user = userEvent.setup();
    renderUi(<Stacked />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const confirm = screen.getByRole('alertdialog', { name: 'Delete it?' });
    const details = screen.getByRole('dialog', { name: 'Details', hidden: true });
    expect(details.closest('[inert]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Really delete' })).toHaveFocus();
    for (let step = 0; step < 6; step += 1) {
      await user.tab();
      expect(confirm).toContainElement(document.activeElement as HTMLElement);
    }
    await user.click(screen.getByRole('button', { name: 'Keep' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(document.documentElement.style.overflow).toBe('hidden');
    expect(details.closest('[inert]')).toBeNull();
    await user.keyboard('{Escape}');
    await waitUnmounted();
    expect(document.documentElement.style.overflow).toBe('');
  });
});

describe('a modal that is open from the first render', () => {
  it('locks scrolling, makes the page inert and takes focus once hydrated', async () => {
    const tree = (
      <I18nProvider locale="en">
        <button>Outside</button>
        <Dialog open onOpenChange={() => {}} title="Low credits">
          <button>Top up</button>
        </Dialog>
      </I18nProvider>
    );
    const host = document.createElement('div');
    document.body.appendChild(host);
    host.innerHTML = renderToString(tree);
    expect(host.querySelector('[role="dialog"]')).toBeNull(); // the server snapshot has no portal
    let root: ReturnType<typeof hydrateRoot> | undefined;
    await act(async () => {
      root = hydrateRoot(host, tree);
    });
    try {
      expect(screen.getByRole('dialog', { name: 'Low credits' })).toBeInTheDocument();
      expect(document.documentElement.style.overflow).toBe('hidden');
      expect(host).toHaveAttribute('inert');
      expect(screen.getByRole('button', { name: 'Top up' })).toHaveFocus();
    } finally {
      await act(async () => root?.unmount());
      host.remove();
    }
    expect(document.documentElement.style.overflow).toBe('');
  });

  it('is set up the same way when it is simply rendered open on the client', () => {
    const { container } = renderUi(
      <Dialog open onOpenChange={() => {}} title="Low credits">
        <button>Top up</button>
      </Dialog>,
    );
    expect(document.documentElement.style.overflow).toBe('hidden');
    expect(container).toHaveAttribute('inert');
    expect(screen.getByRole('button', { name: 'Top up' })).toHaveFocus();
  });
});

describe('focus trap with controls the CSS hides', () => {
  it('wraps Tab and Shift+Tab around the visible controls when the last or first one is hidden', async () => {
    const user = userEvent.setup();
    renderUi(
      <Dialog
        open
        onOpenChange={() => {}}
        title="Share"
        showClose={false}
        footer={
          <>
            <button>Copy link</button>
            <button style={{ display: 'none' }}>Desktop only</button>
          </>
        }
      >
        <button style={{ visibility: 'hidden' }}>Not shown</button>
        <button>Done</button>
      </Dialog>,
    );
    const done = screen.getByRole('button', { name: 'Done' });
    const copy = screen.getByRole('button', { name: 'Copy link' });
    expect(done).toHaveFocus();
    await user.tab();
    expect(copy).toHaveFocus();
    await user.tab(); // the next tabbable would be the hidden button: wrap instead of leaving
    expect(done).toHaveFocus();
    await user.tab({ shift: true });
    expect(copy).toHaveFocus();
  });
});
