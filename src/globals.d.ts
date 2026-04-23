/**
 * Build-time string injected by Vite's `define` (see vite.config.ts).
 * Resolves to the `version` field from package.json at the moment of the
 * build. Used by AddressWidget's capabilities/metadata payload so the
 * agent can see which bundle a given caller is on.
 */
declare const __WIDGET_VERSION__: string;

/**
 * `navigator.userAgentData` — shipped in Chromium, absent from Safari/
 * Firefox as of this writing. We feature-detect rather than rely on lib
 * type coverage (which lags).
 */
interface NavigatorUAData {
  readonly platform?: string;
  readonly mobile?: boolean;
  readonly brands?: Array<{ brand: string; version: string }>;
}

interface Navigator {
  readonly userAgentData?: NavigatorUAData;
}
