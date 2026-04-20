/**
 * HTML sanitizer.
 *
 * DOMPurify with an explicit allowlist. Used whenever we render untrusted
 * HTML — user_event payloads with `format: "html"` or markdown output.
 *
 * No scripts, no iframes, no `on*` handlers, no `javascript:` URLs, no
 * data URIs outside of images (kept for inline base64 images only).
 */

import DOMPurify, { type Config } from 'dompurify';

const CONFIG: Config = {
  ALLOWED_TAGS: [
    'a',
    'abbr',
    'b',
    'blockquote',
    'br',
    'code',
    'div',
    'em',
    'figure',
    'figcaption',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'hr',
    'i',
    'img',
    'li',
    'ol',
    'p',
    'pre',
    'q',
    'small',
    'span',
    'strong',
    'sub',
    'sup',
    'table',
    'tbody',
    'td',
    'th',
    'thead',
    'tr',
    'u',
    'ul'
  ],
  ALLOWED_ATTR: ['class', 'href', 'src', 'alt', 'title', 'target', 'rel'],
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|data:image\/(?:png|jpe?g|gif|webp|svg\+xml);base64,)/i,
  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'textarea', 'button'],
  FORBID_ATTR: ['style'],
  ALLOW_DATA_ATTR: false
};

/** Sanitize an HTML string. Returns HTML safe to inject via innerHTML. */
export function sanitizeHtml(input: string): string {
  const clean = DOMPurify.sanitize(input, CONFIG);
  // Enforce safe defaults on outbound anchors.
  return addRelOnLinks(String(clean));
}

/** Add rel="noopener noreferrer" to any <a target="_blank"> to avoid tabnabbing. */
function addRelOnLinks(html: string): string {
  return html.replace(
    /<a\b([^>]*?\btarget=["']_blank["'][^>]*?)>/gi,
    (match, attrs: string) => {
      if (/\brel=/i.test(attrs)) return match;
      return `<a${attrs} rel="noopener noreferrer">`;
    }
  );
}
