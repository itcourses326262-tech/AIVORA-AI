import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Dialog } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Sheet } from '@/components/ui/sheet';
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
