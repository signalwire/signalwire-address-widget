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

  // Apply options. Every field is assigned as a property; Lit reflects the
  // ones declared `reflect: true` back out to attributes, so devtools still
  // shows them in the DOM. Each is guarded on `!== undefined` so omitting a
  // field leaves the element's own default in place rather than clobbering
  // it with undefined.
  //
  // Voice credentials are guarded like everything else because they are
  // optional in `WidgetOptions`: a `mode: 'chat'` consumer has no token.
  if (options.token !== undefined) widget.token = options.token;
  if (options.destination !== undefined) widget.destination = options.destination;
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
  if (options.nodeId !== undefined) widget.nodeId = options.nodeId;
  if (options.debug !== undefined) widget.debug = options.debug;
  if (options.widgetId !== undefined) widget.widgetId = options.widgetId;
  if (options.autoReattach !== undefined) widget.autoReattach = options.autoReattach;

  // Mode / presentation.
  if (options.mode !== undefined) widget.mode = options.mode;
  if (options.defaultMode !== undefined) widget.defaultMode = options.defaultMode;
  if (options.presentation !== undefined) widget.presentation = options.presentation;
  if (options.position !== undefined) widget.position = options.position;

  // Chat transport. Inert unless `mode` includes chat AND both credentials
  // land — same rule the element enforces internally.
  if (options.gatewayUrl !== undefined) widget.gatewayUrl = options.gatewayUrl;
  if (options.chatKey !== undefined) widget.chatKey = options.chatKey;
  if (options.avatarUrl !== undefined) widget.avatarUrl = options.avatarUrl;
  if (options.chatPlaceholder !== undefined) widget.chatPlaceholder = options.chatPlaceholder;
  if (options.typeToTalk !== undefined) widget.typeToTalk = options.typeToTalk;
  if (options.typeToTalkPlaceholder !== undefined) {
    widget.typeToTalkPlaceholder = options.typeToTalkPlaceholder;
  }
  if (options.chatPersistence !== undefined) widget.chatPersistence = options.chatPersistence;
  if (options.chatAutoOpen !== undefined) widget.chatAutoOpen = options.chatAutoOpen;
  if (options.chatStorageKey !== undefined) widget.chatStorageKey = options.chatStorageKey;
  if (options.chatAlwaysNew !== undefined) widget.chatAlwaysNew = options.chatAlwaysNew;
  if (options.chatEndOnClose !== undefined) widget.chatEndOnClose = options.chatEndOnClose;
  if (options.chatTimeoutSeconds !== undefined) {
    widget.chatTimeoutSeconds = options.chatTimeoutSeconds;
  }
  if (options.userVariables !== undefined) {
    widget.userVariablesAttr = options.userVariables;
  }
  if (options.onEvent !== undefined) {
    widget.onEvent = options.onEvent;
  }
  if (options.onSidecarEvent !== undefined) {
    widget.onSidecarEvent = options.onSidecarEvent;
  }
  if (options.consentRequired !== undefined) widget.consentRequired = options.consentRequired;
  if (options.consentVersion !== undefined) widget.consentVersion = options.consentVersion;
  if (options.onConsentGiven !== undefined) {
    widget.onConsentGiven = options.onConsentGiven;
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
