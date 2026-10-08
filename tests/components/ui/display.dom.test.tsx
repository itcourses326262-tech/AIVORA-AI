import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Inbox } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { Avatar, initialsOf } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { FormError } from '@/components/ui/form-error';
import { Kbd } from '@/components/ui/kbd';
import { Logo } from '@/components/ui/logo';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Skeleton, SkeletonText } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { renderUi } from '../render';

describe('Spinner', () => {
  it('is a status with a localized accessible name', () => {
    renderUi(<Spinner />, { locale: 'ar' });
    // A status is a live region: its text is what gets announced.
    expect(screen.getByRole('status')).toHaveTextContent('جارٍ التحميل');
  });

  it('takes a custom label', () => {
    renderUi(<Spinner label="Generating" />);
    expect(screen.getByRole('status')).toHaveTextContent('Generating');
  });
});

describe('Progress', () => {
  it('exposes a determinate value as a progressbar and clamps it', () => {
    renderUi(<Progress value={64.4} label="Generation" />);
    const bar = screen.getByRole('progressbar', { name: 'Generation' });
    expect(bar).toHaveAttribute('aria-valuenow', '64');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(bar.firstElementChild).toHaveStyle({ width: '64.4%' });
  });

  it('clamps out-of-range values', () => {
    renderUi(
      <>
        <Progress value={150} label="Over" />
        <Progress value={-5} label="Under" />
      </>,
    );
    expect(screen.getByRole('progressbar', { name: 'Over' })).toHaveAttribute(
      'aria-valuenow',
      '100',
    );
    expect(screen.getByRole('progressbar', { name: 'Under' })).toHaveAttribute(
      'aria-valuenow',
      '0',
    );
  });

  it('has no value while indeterminate', () => {
    renderUi(<Progress label="Waiting" />);
    expect(screen.getByRole('progressbar', { name: 'Waiting' })).not.toHaveAttribute(
      'aria-valuenow',
    );
  });

  it('shows a localized percentage when asked', () => {
    renderUi(<Progress value={50} showValue label="P" />, { locale: 'ar' });
    expect(screen.getByText('٥٠٪؜')).toBeInTheDocument();
  });

  it('falls back to a localized name', () => {
    renderUi(<Progress value={10} />, { locale: 'ar' });
    expect(screen.getByRole('progressbar', { name: 'التقدّم' })).toBeInTheDocument();
  });
});

describe('Badge', () => {
  it('renders its content with a decorative dot', () => {
    renderUi(
      <Badge variant="success" dot>
        Succeeded
      </Badge>,
    );
    const badge = screen.getByText('Succeeded');
    expect(badge).toHaveClass('text-success');
    expect(badge.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
  });
});

describe('Avatar', () => {
  it('names the person and shows initials', () => {
    renderUi(<Avatar name="Layla Hassan" />);
    expect(screen.getByRole('img', { name: 'Layla Hassan' })).toHaveTextContent('LH');
  });

  it('computes initials for Latin and Arabic names', () => {
    expect(initialsOf('Layla')).toBe('L');
    expect(initialsOf('layla bint omar hassan')).toBe('LH');
    expect(initialsOf('سارة محمد')).toBe('سم');
    // The article "ال" is not an initial.
    expect(initialsOf('سارة العلي')).toBe('سع');
    expect(initialsOf('   ')).toBe('?');
  });

  it('keeps one colour per name', () => {
    renderUi(
      <>
        <Avatar name="Same" data-testid="a" />
        <Avatar name="Same" data-testid="b" />
      </>,
    );
    expect(screen.getByTestId('a').className).toBe(screen.getByTestId('b').className);
  });
});

describe('Card', () => {
  it('groups content with a title and description', () => {
    renderUi(
      <Card>
        <CardHeader>
          <CardTitle>Text to image</CardTitle>
          <CardDescription>Describe a scene</CardDescription>
        </CardHeader>
        <CardContent>Body</CardContent>
      </Card>,
    );
    expect(screen.getByRole('heading', { name: 'Text to image' })).toBeInTheDocument();
    expect(screen.getByText('Describe a scene')).toBeInTheDocument();
  });

  it('is an h3 unless told otherwise, so a page can keep its heading order', () => {
    renderUi(
      <>
        <CardTitle>Default</CardTitle>
        <CardTitle as="h2">Under the page title</CardTitle>
      </>,
    );
    expect(screen.getByRole('heading', { name: 'Default', level: 3 })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Under the page title', level: 2 }),
    ).toBeInTheDocument();
  });

  it('with href the whole card is one link', () => {
    renderUi(
      <Card href="/explore">
        <CardTitle>Explore</CardTitle>
      </Card>,
    );
    expect(screen.getByRole('link', { name: 'Explore' })).toHaveAttribute('href', '/explore');
  });
});

describe('Skeleton', () => {
  it('is hidden from assistive technology', () => {
    renderUi(
      <>
        <Skeleton data-testid="block" />
        <SkeletonText lines={3} />
      </>,
    );
    expect(screen.getByTestId('block')).toHaveAttribute('aria-hidden', 'true');
  });

  it('makes the last line of text shorter', () => {
    const { container } = renderUi(<SkeletonText lines={3} />);
    const lines = container.querySelectorAll('[aria-hidden="true"] > div');
    expect(lines).toHaveLength(3);
    expect(lines[2]).toHaveClass('w-3/5');
    expect(lines[0]).toHaveClass('w-full');
  });
});

describe('Kbd and Separator', () => {
  it('renders a key cap', () => {
    renderUi(<Kbd>Ctrl</Kbd>);
    expect(screen.getByText('Ctrl').tagName).toBe('KBD');
  });

  it('is decorative by default and a real separator when asked', () => {
    renderUi(
      <>
        <Separator data-testid="decor" />
        <Separator decorative={false} orientation="vertical" />
      </>,
    );
    expect(screen.getByTestId('decor')).toHaveAttribute('role', 'none');
    expect(screen.getByRole('separator')).toHaveAttribute('aria-orientation', 'vertical');
  });
});

describe('EmptyState', () => {
  it('shows a title, a description and the next step', () => {
    renderUi(
      <EmptyState
        icon={<Inbox />}
        title="No creations yet"
        description="They will appear here."
        action={<button>Start</button>}
      />,
    );
    expect(screen.getByRole('heading', { name: 'No creations yet', level: 3 })).toBeInTheDocument();
    expect(screen.getByText('They will appear here.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument();
  });

  it('defaults to a localized title and takes a heading level', () => {
    renderUi(<EmptyState headingLevel={2} />, { locale: 'ar' });
    expect(
      screen.getByRole('heading', { name: 'لا يوجد شيء هنا بعد', level: 2 }),
    ).toBeInTheDocument();
  });
});

describe('ErrorState', () => {
  it('is an alert that says what went wrong in the active language, from the error code', () => {
    renderUi(<ErrorState error={new ApiError('network_error', 0, 'x')} />, { locale: 'ar' });
    expect(screen.getByRole('alert')).toHaveTextContent('حدث خطأ ما');
    expect(screen.getByRole('alert')).toHaveTextContent('تعذّر الاتصال بالخادم');
  });

  it('falls back to a generic message for an unknown failure', () => {
    renderUi(<ErrorState error={new Error('boom')} />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Something went wrong on our side. Please try again.',
    );
  });

  it('offers a retry that calls back, and shows progress while retrying', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const { rerender } = renderUi(
      <ErrorState error={new ApiError('provider_error', 502, 'x')} onRetry={onRetry} />,
    );
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    rerender(
      <ErrorState error={new ApiError('provider_error', 502, 'x')} onRetry={onRetry} retrying />,
    );
    expect(screen.getByRole('button', { name: 'Try again' })).toHaveAttribute('aria-busy', 'true');
  });

  it('has no retry button without a handler, and a custom message wins', () => {
    renderUi(<ErrorState message="Custom" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('Custom')).toBeInTheDocument();
  });
});

describe('FormError', () => {
  it('renders nothing without an error', () => {
    const { container } = renderUi(<FormError />);
    expect(container).toBeEmptyDOMElement();
  });

  it('announces the localized message for an error code', () => {
    renderUi(<FormError error={new ApiError('rate_limited', 429, 'x')} />, { locale: 'ar' });
    expect(screen.getByRole('alert')).toHaveTextContent('عدد الطلبات كبير جدًا');
  });

  it('shows custom content', () => {
    renderUi(<FormError>Incorrect email or password.</FormError>);
    expect(screen.getByRole('alert')).toHaveTextContent('Incorrect email or password.');
  });
});

describe('Logo', () => {
  it('has an accessible name by default and can be decorative next to the brand name', () => {
    renderUi(
      <>
        <Logo />
        <Logo label={null} data-testid="decor" />
      </>,
    );
    expect(screen.getByRole('img', { name: 'AIVORE' })).toBeInTheDocument();
    expect(screen.getByTestId('decor')).toHaveAttribute('aria-hidden', 'true');
  });

  it('the glyph variant has a square viewBox, the full one includes the wordmark', () => {
    renderUi(
      <>
        <Logo variant="glyph" data-testid="glyph" />
        <Logo variant="full" data-testid="full" />
      </>,
    );
    expect(screen.getByTestId('glyph')).toHaveAttribute('viewBox', '0 0 36 36');
    expect(screen.getByTestId('full')).toHaveAttribute('viewBox', '0 0 197 36');
    expect(
      screen.getByTestId('full').querySelector('g[stroke="currentColor"]'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('glyph').querySelector('g')).toBeNull();
  });

  it('gives every instance its own gradient id so two logos never share (or lose) one', () => {
    const { container } = renderUi(
      <>
        <Logo />
        <Logo />
      </>,
    );
    const ids = Array.from(container.querySelectorAll('linearGradient')).map((node) => node.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids)
      expect(container.querySelector(`path[fill="url(#${id})"]`)).toBeInTheDocument();
  });
});
