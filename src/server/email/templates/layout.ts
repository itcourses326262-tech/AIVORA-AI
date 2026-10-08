import 'server-only';
import { dirOf, type Locale } from '@/lib/i18n/locales';

/**
 * The HTML shell shared by every email: a brand header, one card, an optional button and a
 * footer. Table layout and inline styles because mail clients ignore most of CSS; no remote
 * images (nothing to block, nothing that tracks), no scripts. Arabic gets `dir="rtl"` on the
 * document, the body and the tables, right-aligned text and a font stack with Arabic coverage.
 * Everything that reaches markup goes through {@link escapeHtml}.
 */

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

/** Line breaks in a single-line header value would split it (header injection). */
export function singleLine(value: string): string {
  return value.replace(/[\r\n\p{Zl}\p{Zp}]+/gu, ' ').trim();
}

export interface Paragraph {
  /** Already escaped, built by `fill`. */
  html: string;
  text: string;
  tone?: 'normal' | 'muted' | 'warning';
}

export interface LayoutInput {
  locale: Locale;
  subject: string;
  preheader: string;
  brand: string;
  heading: string;
  paragraphs: readonly Paragraph[];
  action?: { label: string; url: string };
  linkHint?: string;
  footer: Paragraph;
}

const COLORS = {
  page: '#f3f2f9',
  card: '#ffffff',
  text: '#1b1a2e',
  muted: '#5f5e78',
  brand: '#5b3df5',
  brandEnd: '#1f9fd0',
  warningBg: '#fff4e5',
  warningText: '#7a3e00',
  border: '#e4e2f0',
} as const;

const FONT_LATIN = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const FONT_ARABIC = "Tahoma,'Segoe UI',Arial,sans-serif";

/** The link must be http(s): it is built from APP_URL, this guards the attribute anyway. */
function safeUrl(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Email links must be http(s) URLs');
  }
  return parsed.toString();
}

function paragraphHtml(paragraph: Paragraph, align: string): string {
  const tone = paragraph.tone ?? 'normal';
  if (tone === 'warning') {
    return `<div class="warn" style="margin:20px 0 0;padding:14px 16px;border-radius:12px;background:${COLORS.warningBg};color:${COLORS.warningText};font-size:15px;line-height:1.7;text-align:${align}">${paragraph.html}</div>`;
  }
  const color = tone === 'muted' ? COLORS.muted : COLORS.text;
  const cls = tone === 'muted' ? 'muted' : 'text';
  const size = tone === 'muted' ? 14 : 16;
  return `<p class="${cls}" style="margin:16px 0 0;color:${color};font-size:${size}px;line-height:1.7;text-align:${align}">${paragraph.html}</p>`;
}

export function renderLayout(input: LayoutInput): { html: string; text: string } {
  const { locale } = input;
  const dir = dirOf(locale);
  const rtl = dir === 'rtl';
  const align = rtl ? 'right' : 'left';
  const font = rtl ? FONT_ARABIC : FONT_LATIN;
  const action = input.action
    ? { label: input.action.label, url: safeUrl(input.action.url) }
    : null;

  const button = action
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" dir="${dir}" style="margin:28px 0 8px"><tr><td align="${align}" style="border-radius:12px;background:${COLORS.brand}"><a href="${escapeHtml(action.url)}" style="display:inline-block;padding:14px 28px;border-radius:12px;background:${COLORS.brand};color:#ffffff;font-family:${font};font-size:16px;font-weight:700;line-height:1.2;text-decoration:none">${escapeHtml(action.label)}</a></td></tr></table>`
    : '';
  const fallbackLink =
    action && input.linkHint
      ? `<p class="muted" style="margin:16px 0 0;color:${COLORS.muted};font-size:13px;line-height:1.7;text-align:${align}">${escapeHtml(input.linkHint)}<br><a href="${escapeHtml(action.url)}" dir="ltr" style="color:${COLORS.brand};word-break:break-all;unicode-bidi:isolate">${escapeHtml(action.url)}</a></p>`
      : '';

  const html = `<!doctype html>
<html lang="${locale}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(input.subject)}</title>
<style>
@media (prefers-color-scheme: dark){
body,.page{background:#100f1d!important}
.card{background:#1a1930!important}
.text,h1{color:#ecebf8!important}
.muted{color:#b4b3cf!important}
.rule{border-color:#2f2d4d!important}
}
@media only screen and (max-width:600px){
.card{border-radius:0!important}
.pad{padding:24px 20px!important}
}
</style>
</head>
<body class="page" dir="${dir}" style="margin:0;padding:0;background:${COLORS.page}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all">${escapeHtml(input.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="${dir}" class="page" style="background:${COLORS.page}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" dir="${dir}" class="card" style="width:100%;max-width:560px;background:${COLORS.card};border-radius:16px;overflow:hidden">
<tr><td style="padding:20px 28px;background:${COLORS.brand};background-image:linear-gradient(135deg,${COLORS.brand},${COLORS.brandEnd});text-align:${align}"><span dir="ltr" style="font-family:${FONT_LATIN};font-size:22px;font-weight:800;letter-spacing:3px;color:#ffffff;unicode-bidi:isolate">${escapeHtml(input.brand)}</span></td></tr>
<tr><td class="pad" style="padding:32px 28px;font-family:${font};text-align:${align}">
<h1 style="margin:0;color:${COLORS.text};font-family:${font};font-size:24px;line-height:1.4;font-weight:700;text-align:${align}">${escapeHtml(input.heading)}</h1>
${input.paragraphs.map((paragraph) => paragraphHtml(paragraph, align)).join('\n')}
${button}
${fallbackLink}
<hr class="rule" style="margin:28px 0 0;border:0;border-top:1px solid ${COLORS.border}">
<p class="muted" style="margin:16px 0 0;color:${COLORS.muted};font-size:12px;line-height:1.7;text-align:${align}">${input.footer.html}</p>
</td></tr>
</table>
</td></tr></table>
</body>
</html>`;

  const text = [
    input.brand,
    input.heading,
    ...input.paragraphs.map((paragraph) => paragraph.text),
    ...(action ? [`${action.label}:\n${action.url}`] : []),
    `--\n${input.footer.text}`,
  ].join('\n\n');

  return { html, text: `${text}\n` };
}
