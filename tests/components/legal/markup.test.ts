import { describe, expect, it } from 'vitest';
import {
  linkTargetsOf,
  parseInline,
  parseMarkup,
  tokensOf,
  type Block,
  type ParseOptions,
} from '@/components/legal/markup';

const draft: ParseOptions = { draft: true, linkTargets: ['/privacy', '/account'] };
const final: ParseOptions = { draft: false, linkTargets: ['/privacy', '/account'] };

describe('parseMarkup blocks', () => {
  it('splits paragraphs on blank lines and joins wrapped lines with a space', () => {
    const blocks = parseMarkup('First line\n  continues here.\n\nSecond paragraph.', draft);
    expect(blocks).toEqual<Block[]>([
      { type: 'paragraph', inline: [{ type: 'text', text: 'First line continues here.' }] },
      { type: 'paragraph', inline: [{ type: 'text', text: 'Second paragraph.' }] },
    ]);
  });

  it('reads bullet lists, with continuation lines belonging to the item above', () => {
    const [list] = parseMarkup('- one\n- two\n  still two\n- three', draft);
    expect(list).toEqual<Block>({
      type: 'list',
      items: [
        [{ type: 'text', text: 'one' }],
        [{ type: 'text', text: 'two still two' }],
        [{ type: 'text', text: 'three' }],
      ],
    });
  });

  it('reads sub-headings, with text allowed to follow on the next line', () => {
    const blocks = parseMarkup('### Prices\nAre in riyals.\n\n### Payments\n- card', draft);
    expect(blocks.map((block) => block.type)).toEqual([
      'subheading',
      'paragraph',
      'subheading',
      'list',
    ]);
    expect(blocks[0]).toEqual({ type: 'subheading', text: 'Prices' });
  });

  it('starts a list right after a paragraph without a blank line', () => {
    const blocks = parseMarkup('Intro:\n- a\n- b', draft);
    expect(blocks.map((block) => block.type)).toEqual(['paragraph', 'list']);
  });

  it('ignores leading and trailing blank lines and indentation', () => {
    const blocks = parseMarkup('\n\n    Indented text.\n\n', draft);
    expect(blocks).toHaveLength(1);
    expect(parseMarkup('', draft)).toEqual([]);
  });

  it('does not take a dash inside a sentence for a bullet', () => {
    const blocks = parseMarkup('Pay - or do not.', draft);
    expect(blocks).toEqual<Block[]>([
      { type: 'paragraph', inline: [{ type: 'text', text: 'Pay - or do not.' }] },
    ]);
  });
});

describe('parseInline', () => {
  it('reads bold, code, links and tokens in order', () => {
    expect(
      parseInline('A **bold** [[aivore_theme]] [link](/privacy) {companyName}.', draft),
    ).toEqual([
      { type: 'text', text: 'A ' },
      { type: 'strong', text: 'bold' },
      { type: 'text', text: ' ' },
      { type: 'code', text: 'aivore_theme' },
      { type: 'text', text: ' ' },
      { type: 'link', label: 'link', href: '/privacy' },
      { type: 'text', text: ' ' },
      { type: 'token', name: 'companyName' },
      { type: 'text', text: '.' },
    ]);
  });

  it('renders a link to an unlisted page as its label only', () => {
    expect(parseInline('[evil](https://evil.example/x) and [odd](//evil.example)', draft)).toEqual([
      { type: 'text', text: 'evil' },
      { type: 'text', text: ' and ' },
      { type: 'text', text: 'odd' },
    ]);
    expect(
      parseInline('[javascript](javascript:alert(1))', draft).some((n) => n.type === 'link'),
    ).toBe(false);
  });

  it('shows the "to confirm" flag in a draft', () => {
    expect(parseInline('twelve months {confirm}.', draft)).toEqual([
      { type: 'text', text: 'twelve months ' },
      { type: 'token', name: 'confirm' },
      { type: 'text', text: '.' },
    ]);
  });

  it('drops the flag and the space before it once the text is final', () => {
    expect(parseInline('twelve months {confirm}.', final)).toEqual([
      { type: 'text', text: 'twelve months' },
      { type: 'text', text: '.' },
    ]);
    expect(parseInline('a {confirm}; b {confirm}', final)).toEqual([
      { type: 'text', text: 'a' },
      { type: 'text', text: '; b' },
    ]);
  });

  it('keeps every other token whether or not the text is final', () => {
    expect(parseInline('{vatPercent}%', final)).toEqual([
      { type: 'token', name: 'vatPercent' },
      { type: 'text', text: '%' },
    ]);
  });

  it('works inside list items too', () => {
    const [list] = parseMarkup('- keep it {confirm};\n- next', final);
    expect(list).toMatchObject({
      type: 'list',
      items: [
        [
          { type: 'text', text: 'keep it' },
          { type: 'text', text: ';' },
        ],
        expect.anything(),
      ],
    });
  });
});

describe('tokensOf and linkTargetsOf', () => {
  it('list what a body uses', () => {
    const body = 'Write to {supportEmail} {confirm}. See [terms](/terms) and [me](/account).';
    expect(tokensOf(body)).toEqual(['supportEmail', 'confirm']);
    expect(linkTargetsOf(body)).toEqual(['/terms', '/account']);
  });
});
