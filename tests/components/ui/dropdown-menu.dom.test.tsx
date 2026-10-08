import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { renderUi } from '../render';

function Demo({ onSelect = vi.fn() }: { onSelect?: (name: string) => void }) {
  return (
    <>
      <DropdownMenu label="Actions" trigger={<button>Menu</button>}>
        <DropdownMenuLabel>Creation</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => onSelect('download')}>Download</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onSelect('duplicate')}>Duplicate</DropdownMenuItem>
        <DropdownMenuItem disabled onSelect={() => onSelect('disabled')}>
          Disabled
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onSelect={() => onSelect('delete')}>
          Delete
        </DropdownMenuItem>
      </DropdownMenu>
      <button>After</button>
    </>
  );
}

const trigger = () => screen.getByRole('button', { name: 'Menu' });
const item = (name: string) => screen.getByRole('menuitem', { name });

describe('DropdownMenu', () => {
  it('announces itself on the trigger and opens a labelled menu on click', async () => {
    const user = userEvent.setup();
    renderUi(<Demo />);
    expect(trigger()).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    await user.click(trigger());
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    const menu = screen.getByRole('menu', { name: 'Actions' });
    expect(trigger()).toHaveAttribute('aria-controls', menu.id);
    expect(screen.getAllByRole('menuitem')).toHaveLength(4);
    expect(screen.getByRole('separator')).toBeInTheDocument();
  });

  it('falls back to the trigger as the menu name', async () => {
    const user = userEvent.setup();
    renderUi(
      <DropdownMenu trigger={<button>Account</button>}>
        <DropdownMenuItem>One</DropdownMenuItem>
      </DropdownMenu>,
    );
    await user.click(screen.getByRole('button', { name: 'Account' }));
    expect(screen.getByRole('menu', { name: 'Account' })).toBeInTheDocument();
  });

  it('opens with ArrowDown on the first item and ArrowUp on the last', async () => {
    const user = userEvent.setup();
    renderUi(<Demo />);
    trigger().focus();
    await user.keyboard('{ArrowDown}');
    expect(item('Download')).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(trigger()).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(item('Delete')).toHaveFocus();
  });

  it('opens with Enter and Space (the trigger is a button)', async () => {
    const user = userEvent.setup();
    renderUi(<Demo />);
    trigger().focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.keyboard(' ');
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('ArrowDown/ArrowUp wrap and skip disabled items; Home and End jump', async () => {
    const user = userEvent.setup();
    renderUi(<Demo />);
    trigger().focus();
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{ArrowDown}');
    expect(item('Duplicate')).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(item('Delete')).toHaveFocus(); // "Disabled" is skipped
    await user.keyboard('{ArrowDown}');
    expect(item('Download')).toHaveFocus(); // wrapped
    await user.keyboard('{ArrowUp}');
    expect(item('Delete')).toHaveFocus();
    await user.keyboard('{Home}');
    expect(item('Download')).toHaveFocus();
    await user.keyboard('{End}');
    expect(item('Delete')).toHaveFocus();
  });

  it('typeahead jumps to the item that starts with the typed letters', async () => {
    const user = userEvent.setup();
    renderUi(<Demo />);
    trigger().focus();
    await user.keyboard('{ArrowDown}');
    await user.keyboard('del');
    expect(item('Delete')).toHaveFocus();
  });

  it('selecting an item runs its handler, closes the menu and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderUi(<Demo onSelect={onSelect} />);
    await user.click(trigger());
    await user.click(item('Duplicate'));
    expect(onSelect).toHaveBeenCalledWith('duplicate');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();
  });

  it('Enter on an item selects it', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderUi(<Demo onSelect={onSelect} />);
    trigger().focus();
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onSelect).toHaveBeenCalledWith('download');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('a disabled item does nothing', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderUi(<Demo onSelect={onSelect} />);
    await user.click(trigger());
    await user.click(screen.getByRole('menuitem', { name: 'Disabled' }));
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('preventDefault in onSelect keeps the menu open', async () => {
    const user = userEvent.setup();
    renderUi(
      <DropdownMenu trigger={<button>Menu</button>}>
        <DropdownMenuItem onSelect={(event) => event.preventDefault()}>Stay</DropdownMenuItem>
      </DropdownMenu>,
    );
    await user.click(trigger());
    await user.click(item('Stay'));
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('closes on Escape (focus back on the trigger) and on an outside click', async () => {
    const user = userEvent.setup();
    renderUi(<Demo />);
    await user.click(trigger());
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();
    await user.click(trigger());
    await user.click(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('toggles closed when the trigger is clicked again', async () => {
    const user = userEvent.setup();
    renderUi(<Demo />);
    await user.click(trigger());
    await user.click(trigger());
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('Tab closes the menu and moves on to the element after the trigger', async () => {
    const user = userEvent.setup();
    renderUi(<Demo />);
    trigger().focus();
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Tab}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
  });

  it('renders a link item that navigates instead of stealing focus back', async () => {
    const user = userEvent.setup();
    renderUi(
      <DropdownMenu trigger={<button>Menu</button>}>
        <DropdownMenuItem href="/account">Account</DropdownMenuItem>
      </DropdownMenu>,
    );
    await user.click(trigger());
    const link = screen.getByRole('menuitem', { name: 'Account' });
    expect(link).toHaveAttribute('href', '/account');
    expect(link.tagName).toBe('A');
  });

  it('is controllable', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderUi(
      <DropdownMenu open={false} onOpenChange={onOpenChange} trigger={<button>Menu</button>}>
        <DropdownMenuItem>One</DropdownMenuItem>
      </DropdownMenu>,
    );
    await user.click(trigger());
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('keeps the trigger own handlers and ref working', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    renderUi(
      <DropdownMenu trigger={<button onClick={onClick}>Menu</button>}>
        <DropdownMenuItem>One</DropdownMenuItem>
      </DropdownMenu>,
    );
    await user.click(trigger());
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });
});

describe('DropdownMenuRadioGroup', () => {
  function Language({ onChange }: { onChange?: (value: string) => void }) {
    const [value, setValue] = useState('en');
    return (
      <DropdownMenu trigger={<button>Language</button>}>
        <DropdownMenuRadioGroup
          label="Language"
          value={value}
          onValueChange={(next) => {
            setValue(next);
            onChange?.(next);
          }}
        >
          <DropdownMenuRadioItem value="ar">العربية</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="en">English</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenu>
    );
  }

  it('exposes a labelled group of menuitemradio with the current one checked', async () => {
    const user = userEvent.setup();
    renderUi(<Language />);
    await user.click(screen.getByRole('button', { name: 'Language' }));
    expect(screen.getByRole('group', { name: 'Language' })).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: 'English' })).toBeChecked();
    expect(screen.getByRole('menuitemradio', { name: 'العربية' })).not.toBeChecked();
  });

  it('choosing one reports it and closes the menu', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderUi(<Language onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Language' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'العربية' }));
    expect(onChange).toHaveBeenCalledWith('ar');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});

describe('where focus lands when the menu opens', () => {
  it('goes to the first item for Enter and Space, and to the menu itself for a pointer click', async () => {
    const user = userEvent.setup();
    renderUi(<Demo />);
    trigger().focus();
    await user.keyboard('{Enter}');
    expect(item('Download')).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(trigger()).toHaveFocus();
    await user.keyboard(' ');
    expect(item('Download')).toHaveFocus();
    await user.keyboard('{Escape}');
    await user.click(trigger());
    expect(screen.getByRole('menu')).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(item('Download')).toHaveFocus();
  });
});

describe('DropdownMenuItem as a link', () => {
  it('keeps its id, title, aria-* and data-* attributes, and drops the button-only ones', async () => {
    const user = userEvent.setup();
    renderUi(
      <DropdownMenu trigger={<button>Menu</button>}>
        <DropdownMenuItem
          href="/account"
          id="account-link"
          title="Your account"
          aria-label="Open account"
          data-testid="account-item"
          type="submit"
          name="ignored"
        >
          Account
        </DropdownMenuItem>
      </DropdownMenu>,
    );
    await user.click(trigger());
    const link = screen.getByRole('menuitem', { name: 'Open account' });
    expect(link).toHaveAttribute('href', '/account');
    expect(link).toHaveAttribute('id', 'account-link');
    expect(link).toHaveAttribute('title', 'Your account');
    expect(link).toHaveAttribute('data-testid', 'account-item');
    expect(link).not.toHaveAttribute('type');
    expect(link).not.toHaveAttribute('name');
  });

  it('the button variant forwards the same attributes', async () => {
    const user = userEvent.setup();
    renderUi(
      <DropdownMenu trigger={<button>Menu</button>}>
        <DropdownMenuItem id="run" aria-label="Run it" data-testid="run-item">
          Run
        </DropdownMenuItem>
      </DropdownMenu>,
    );
    await user.click(trigger());
    const button = screen.getByRole('menuitem', { name: 'Run it' });
    expect(button).toHaveAttribute('id', 'run');
    expect(button).toHaveAttribute('data-testid', 'run-item');
  });
});
