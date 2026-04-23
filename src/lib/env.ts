/**
 * Environment-detection helpers used by AddressWidget's metadata payload.
 * Every helper tolerates missing globals and returns `undefined` when the
 * value can't be resolved (so the JSON payload stays shaped the same way
 * across browsers, with absent keys omitted rather than nulled).
 */

/**
 * Best-effort OS / platform label. Prefers `navigator.userAgentData.platform`
 * ("macOS" / "Windows" / "Linux" / "Android" / "iOS") which is Chromium-
 * exclusive as of now, and falls back to a narrow UA sniff for Safari /
 * Firefox so the value is consistent across browsers.
 */
export function detectPlatform(): string | undefined {
  if (typeof navigator === 'undefined') return undefined;
  const modern = navigator.userAgentData?.platform;
  if (modern) return modern;
  const ua = navigator.userAgent || '';
  if (/\b(iPhone|iPad|iPod)\b/.test(ua)) return 'iOS';
  if (/\bAndroid\b/.test(ua)) return 'Android';
  if (/\bMac OS X\b/.test(ua) || /\bMacintosh\b/.test(ua)) return 'macOS';
  if (/\bWindows\b/.test(ua)) return 'Windows';
  if (/\bCrOS\b/.test(ua)) return 'ChromeOS';
  if (/\bLinux\b/.test(ua)) return 'Linux';
  return undefined;
}

/** IANA timezone name, or undefined if `Intl` isn't available. */
export function safeTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/**
 * `matchMedia(query).matches` with a guard for non-browser environments
 * (SSR) and for older webviews where `matchMedia` is absent.
 */
export function safeMatchMedia(query: string): boolean | undefined {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return undefined;
  }
  try {
    return window.matchMedia(query).matches;
  } catch {
    return undefined;
  }
}
