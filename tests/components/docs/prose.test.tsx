import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Inline, Prose } from '@/components/docs/prose';

const html = (node: React.ReactNode) => renderToStaticMarkup(<>{node}</>);

describe('Inline', () => {
  it('renders code, bold and links', () => {
    const markup = html(<Inline text="Use `limit` and **care**, see [the docs](/docs)." />);
    expect(markup).toContain('<code dir="ltr" lang="en"');
    expect(markup).toContain('>limit</code>');
    expect(markup).toContain('<strong class="font-semibold text-foreground">care</strong>');
    expect(markup).toContain('<a href="/docs"');
    expect(markup).not.toContain('target=');
  });

  it('opens an outside link in a new tab without leaking the opener', () => {
    const markup = html(<Inline text="[x](https://example.com/a)" />);
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noopener noreferrer"');
  });

  it('leaves text that merely looks like markup alone', () => {
    expect(html(<Inline text="a ` b" />)).toBe('a ` b');
    expect(html(<Inline text="**" />)).toBe('**');
    expect(html(<Inline text="[no link]" />)).toBe('[no link]');
  });

  it('never turns text into markup', () => {
    const markup = html(<Inline text="`<script>alert(1)</script>` <b>x</b>" />);
    expect(markup).not.toContain('<script>');
    expect(markup).not.toContain('<b>');
    expect(markup).toContain('&lt;script&gt;');
  });
});

describe('Prose', () => {
  it('makes paragraphs of blocks and a list of bullet lines', () => {
    const markup = html(<Prose text={'First.\n\nSecond.\n\n- one\n- two with `code`'} />);
    expect(markup.match(/<p>/g)).toHaveLength(2);
    expect(markup.match(/<li>/g)).toHaveLength(2);
    expect(markup).toContain('<ul');
  });

  it('keeps a block with one line that is not a bullet as a paragraph', () => {
    const markup = html(<Prose text={'- one\nnot a bullet'} />);
    expect(markup).not.toContain('<ul');
    expect(markup).toContain('<p>');
  });
});
