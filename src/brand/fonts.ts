/**
 * Injects the SignalWire brand fonts (Instrument Sans, Lexend, JetBrains Mono)
 * from Google Fonts into the host document `<head>` exactly once.
 *
 * Why document.head and not inside our shadow root:
 * @font-face declarations don't cross shadow boundaries via an @import inside
 * the shadow, and duplicating <link> tags in every component's shadow root
 * would fire multiple identical network requests. Loading at the document
 * root once lets every shadow root inherit the loaded font families through
 * their font-family declarations — this is the standard pattern for shadowed
 * widgets that need custom fonts.
 *
 * Consumers who already load these fonts get a deduped request (browser
 * short-circuits identical <link href>). Consumers who can't allow external
 * font loads can pre-declare the same @font-face rules before the widget
 * initializes and the marker in this module will skip the injection.
 */

const FONTS_MARKER_ATTR = 'data-signalwire-address-fonts';
const FONTS_HREF =
  'https://fonts.googleapis.com/css2?' +
  'family=Instrument+Sans:wght@400;500;600;700' +
  '&family=JetBrains+Mono:wght@400;500' +
  '&family=Lexend:wght@300;400;500;600' +
  '&display=swap';

const PRECONNECT_HREFS = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'];

let loaded = false;

export function loadBrandFonts(): void {
  if (loaded || typeof document === 'undefined') return;
  loaded = true;

  // Respect a pre-existing injection marker — consumer may have deliberately
  // opted out or may be self-hosting the fonts.
  if (document.head.querySelector(`link[${FONTS_MARKER_ATTR}]`)) return;

  for (const href of PRECONNECT_HREFS) {
    if (document.head.querySelector(`link[rel="preconnect"][href="${href}"]`)) continue;
    const link = document.createElement('link');
    link.rel = 'preconnect';
    link.href = href;
    if (href.includes('gstatic')) link.crossOrigin = 'anonymous';
    link.setAttribute(FONTS_MARKER_ATTR, 'preconnect');
    document.head.appendChild(link);
  }

  const fontLink = document.createElement('link');
  fontLink.rel = 'stylesheet';
  fontLink.href = FONTS_HREF;
  fontLink.setAttribute(FONTS_MARKER_ATTR, 'stylesheet');
  document.head.appendChild(fontLink);
}
