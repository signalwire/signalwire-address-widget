/**
 * Public API for @signalwire/address-widget.
 *
 * Three consumption shapes, all backed by the same <signalwire-address>
 * element defined in AddressWidget.ts:
 *
 *   1. ESM import:
 *        import { mount } from '@signalwire/address-widget';
 *        mount('#target', { token, destination });
 *
 *   2. UMD <script> tag:
 *        <script src=".../address-widget.umd.js"></script>
 *        <script>SignalWireAddressWidget.mount('#t', { token, destination });</script>
 *
 *   3. Declarative custom element:
 *        <signalwire-address token="..." destination="/public/agent"></signalwire-address>
 *
 * The element registers itself at import time (side-effect of the
 * @customElement decorator in AddressWidget.ts).
 */

// Register the element. Side-effect import.
import { AddressWidget } from './AddressWidget';
export { AddressWidget };

import type { WidgetOptions } from './types';
export type {
  Theme,
  WidgetOptions,
  DisplayContentPayload,
  UserEventPayload,
  BeforeDialDetail,
  CallEventDetail
} from './types';

/** Published library version. Injected at build time via vite define. */
export const VERSION = '0.1.0';

type Target = string | Element;

function resolveTarget(target: Target): Element {
  if (typeof target === 'string') {
    const el = document.querySelector(target);
    if (!el) {
      throw new Error(`[address-widget] no element matches selector "${target}"`);
    }
    return el;
  }
  return target;
}

/**
 * Programmatic mount.
 *
 * Creates a `<signalwire-address>` inside the given target element and
 * applies the provided options as attributes/properties. Any existing
 * children of the target become the launcher's slotted content (so a
 * consumer who put their own icon or label in the div keeps it).
 *
 * Returns the created element so callers can wire event listeners, call
 * `open()` / `close()` / `hangup()` programmatically, or destroy it.
 */
export function mount(target: Target, options: WidgetOptions): AddressWidget {
  const host = resolveTarget(target);
  const widget = document.createElement('signalwire-address') as AddressWidget;

  // Apply options. Attributes used where a reflecting property exists
  // (so devtools shows them in the DOM); direct property assignment used
  // for values that can't round-trip through attributes (token, JSON).
  widget.token = options.token;
  widget.destination = options.destination;
  if (options.label !== undefined) widget.label = options.label;
  if (options.theme !== undefined) widget.theme = options.theme;
  if (options.video !== undefined) widget.video = options.video;
  if (options.audio !== undefined) widget.audio = options.audio;
  if (options.poster !== undefined) widget.poster = options.poster;
  if (options.layout !== undefined) widget.layout = options.layout;
  if (options.showLocalVideo !== undefined) widget.showLocalVideo = options.showLocalVideo;
  if (options.echoCancellation !== undefined) widget.echoCancellation = options.echoCancellation;
  if (options.noiseSuppression !== undefined) widget.noiseSuppression = options.noiseSuppression;
  if (options.autoGainControl !== undefined) widget.autoGainControl = options.autoGainControl;
  if (options.inputVolume !== undefined) widget.inputVolume = options.inputVolume;
  if (options.autoIdentify !== undefined) widget.autoIdentify = options.autoIdentify;
  if (options.userVariables !== undefined) {
    widget.userVariablesAttr = options.userVariables;
  }
  if (options.onEvent !== undefined) {
    widget.onEvent = options.onEvent;
  }

  // Move existing children of target into the widget as slot content.
  // Consumer's own <img>/<button>/<span> etc. renders inside the launcher.
  while (host.firstChild) {
    widget.appendChild(host.firstChild);
  }

  host.appendChild(widget);
  return widget;
}

/**
 * Unmount a widget previously created by `mount()`. Calls `close()` to
 * tear down the call, then removes the element from the DOM.
 */
export async function unmount(widget: AddressWidget): Promise<void> {
  try {
    await widget.close();
  } catch {
    /* noop */
  }
  widget.parentElement?.removeChild(widget);
}
