import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

describe('jsdom environment', () => {
  it('renders React components with jest-dom matchers available', () => {
    render(<p dir="rtl">مرحبا</p>);
    expect(screen.getByText('مرحبا')).toBeInTheDocument();
    expect(document.body).toContainElement(screen.getByText('مرحبا'));
  });
});
