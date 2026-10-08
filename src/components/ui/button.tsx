'use client';

import Link from 'next/link';
import type { ComponentProps, MouseEvent, ReactNode } from 'react';
import { buttonVariants, type ButtonStyleOptions } from './button-variants';
import { SpinnerIcon } from './spinner-icon';

interface ButtonOwnProps extends ButtonStyleOptions {
  /** Shows a spinner, sets `aria-busy` and ignores clicks (the button stays focusable). */
  loading?: boolean;
  /** Icon before the label (after it in right-to-left layouts happens automatically). */
  startIcon?: ReactNode;
  endIcon?: ReactNode;
}

export type ButtonAsButtonProps = ButtonOwnProps &
  Omit<ComponentProps<'button'>, keyof ButtonOwnProps | 'href'> & { href?: undefined };

export type ButtonAsLinkProps = ButtonOwnProps &
  Omit<ComponentProps<'a'>, keyof ButtonOwnProps | 'href'> & {
    href: string;
    /** Forwarded to Next's `Link` for internal paths. */
    prefetch?: boolean | null;
    replace?: boolean;
    scroll?: boolean;
  };

export type ButtonProps = ButtonAsButtonProps | ButtonAsLinkProps;

function isExternal(href: string): boolean {
  return /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href);
}

/**
 * A button, or a link that looks like one when `href` is given (internal paths use Next's `Link`).
 * Icons sit at the inline start/end, so they swap sides in right-to-left layouts; wrap arrows in
 * {@link Directional} to flip them as well.
 */
export function Button(props: ButtonProps) {
  const {
    variant,
    size,
    fullWidth,
    className,
    loading = false,
    startIcon,
    endIcon,
    children,
    ...rest
  } = props;
  const classes = buttonVariants({ variant, size, fullWidth, className });
  const content = (
    <>
      {loading ? <SpinnerIcon /> : startIcon}
      {children}
      {endIcon}
    </>
  );

  if (typeof rest.href === 'string') {
    const { href, onClick, prefetch, replace, scroll, target, rel, ...anchor } = rest as Omit<
      ButtonAsLinkProps,
      keyof ButtonOwnProps
    >;
    const shared = {
      ...anchor,
      target,
      rel: target === '_blank' ? (rel ?? 'noopener noreferrer') : rel,
      className: classes,
      'aria-busy': loading || undefined,
      'aria-disabled': loading || undefined,
      onClick: (event: MouseEvent<HTMLAnchorElement>) => {
        if (loading) event.preventDefault();
        else onClick?.(event);
      },
    };
    if (isExternal(href)) {
      return (
        <a href={href} {...shared}>
          {content}
        </a>
      );
    }
    return (
      <Link href={href} prefetch={prefetch} replace={replace} scroll={scroll} {...shared}>
        {content}
      </Link>
    );
  }

  const {
    onClick,
    type = 'button',
    ...button
  } = rest as Omit<ButtonAsButtonProps, keyof ButtonOwnProps>;
  return (
    <button
      type={type}
      {...button}
      className={classes}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      onClick={(event) => {
        if (loading) event.preventDefault();
        else onClick?.(event);
      }}
    >
      {content}
    </button>
  );
}
