import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Plus } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { renderUi } from '../render';

describe('Button', () => {
  it('is a type="button" by default so it never submits a form by accident', () => {
    renderUi(<Button>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'button');
  });

  it('calls onClick and respects disabled', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    renderUi(
      <>
        <Button onClick={onClick}>Go</Button>
        <Button onClick={onClick} disabled>
          Off
        </Button>
      </>,
    );
    await user.click(screen.getByRole('button', { name: 'Go' }));
    await user.click(screen.getByRole('button', { name: 'Off' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('while loading: announces aria-busy, ignores clicks and stays focusable', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    renderUi(
      <Button loading onClick={onClick}>
        Generating
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Generating' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).not.toBeDisabled();
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
    expect(button).toHaveFocus();
  });

  it('does not submit a form while loading, but does afterwards', async () => {
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    const user = userEvent.setup();
    const { rerender } = renderUi(
      <form onSubmit={onSubmit}>
        <Button type="submit" loading>
          Send
        </Button>
      </form>,
    );
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSubmit).not.toHaveBeenCalled();
    rerender(
      <form onSubmit={onSubmit}>
        <Button type="submit">Send</Button>
      </form>,
    );
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('puts start and end icons around the label (DOM order, so they swap sides in RTL)', () => {
    renderUi(
      <Button startIcon={<Plus data-testid="start" />} endIcon={<span data-testid="end" />}>
        Add
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Add' });
    const children = Array.from(button.children);
    expect(children[0]).toBe(screen.getByTestId('start'));
    expect(children[children.length - 1]).toBe(screen.getByTestId('end'));
  });

  it('renders an internal href as a link and an external one as a plain anchor with a safe rel', () => {
    renderUi(
      <>
        <Button href="/studio">Studio</Button>
        <Button href="https://example.com/docs" target="_blank">
          Docs
        </Button>
      </>,
    );
    expect(screen.getByRole('link', { name: 'Studio' })).toHaveAttribute('href', '/studio');
    const external = screen.getByRole('link', { name: 'Docs' });
    expect(external).toHaveAttribute('href', 'https://example.com/docs');
    expect(external).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('a loading link does not navigate', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    renderUi(
      <Button href="/studio" loading onClick={onClick}>
        Open
      </Button>,
    );
    const link = screen.getByRole('link', { name: 'Open' });
    expect(link).toHaveAttribute('aria-busy', 'true');
    await user.click(link);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('buttonVariants lets any element look like a button and merges overrides', () => {
    const classes = buttonVariants({
      variant: 'danger',
      size: 'lg',
      fullWidth: true,
      className: 'h-20',
    });
    expect(classes).toContain('bg-danger-solid');
    expect(classes).toContain('w-full');
    // tailwind-merge: the caller's height wins over the size's.
    expect(classes).toContain('h-20');
    expect(classes).not.toContain('h-12');
  });
});
