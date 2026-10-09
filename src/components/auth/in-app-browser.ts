/**
 * Google refuses to sign anyone in from an embedded WebView (`disallowed_useragent`), and the
 * browsers that social apps open links in are exactly that. Many of our visitors arrive from those
 * apps, so the sign-in page recognises them by user agent and says what to do instead. Matching is
 * deliberately plain: a miss only means the note is not shown up front (the Firebase error codes
 * that such a browser produces are handled too), a false hit only adds a hint.
 */
const IN_APP_USER_AGENTS: readonly RegExp[] = [
  // Facebook and Messenger: iOS "FBAN/FBIOS;FBAV/…", Android "FB_IAB/FB4A;FBAV/…".
  /\bFB(?:AN|AV|_IAB|IOS)\b/,
  /\bInstagram\b/i,
  // TikTok, under both of its names, and the ByteDance WebView it is built on.
  /\b(?:TikTok|musical_ly|BytedanceWebview)\b/i,
  /\bSnapchat\b/i,
  /\bTwitter\b/i,
  // LINE puts "Line/<version>" in the user agent.
  /\bLine\/\d/,
  /\bWhatsApp\b/i,
  // The Android System WebView: "(Linux; Android 14; Pixel 8 Build/…; wv)".
  /;\s*wv\)/,
];

export function isInAppBrowser(userAgent: string): boolean {
  return IN_APP_USER_AGENTS.some((pattern) => pattern.test(userAgent));
}
