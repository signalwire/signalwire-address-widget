/**
 * Video frame
 *
 * Central stage of the overlay. Before the call connects, shows a branded
 * poster with a fuchsia breathing glow. Once a Call object is available,
 * embeds `<sw-call-media>` from @signalwire/web-components which handles
 * the remote stream, layout layers, and aspect-ratio fitting.
 *
 * Layered state indicators (rings) sit on top of the frame and react to
 * flags driven by the event multiplexer (task #12):
 *   - `aiSpeaking`       → turquoise pulse (positive signal, AI is talking)
 *   - `reconnecting`     → fuchsia shimmer (recovery in progress)
 *   - `networkWarning`   → gold pulse (network issue detected)
 *
 * Brand discipline: exactly one ring visible at a time; `reconnecting`
 * overrides `networkWarning` overrides `aiSpeaking`.
 */

import { css, html } from 'lit';
import { ref } from 'lit/directives/ref.js';
import type { Ref } from 'lit/directives/ref.js';
import type { TemplateResult } from 'lit';
import type { Call } from '@signalwire/js';

// Register the sub-component custom elements by import side-effect.
import '@signalwire/web-components/call-media';
import '@signalwire/web-components/participants';
import '@signalwire/web-components/self-media';

/**
 * Default SignalWire poster shown before a call is live.
 * Consumer can override via `--sw-address-poster-src: url(...)`.
 */
const DEFAULT_POSTER_URL = 'https://mcdn.signalwire.com/images/v2/social_generic.png';

export type VideoFrameRing = 'none' | 'ai-speaking' | 'reconnecting' | 'network-warning';

export interface VideoFrameContext {
  /** The active call, or null before dial / after hangup. */
  call: Call | null;
  /** Which indicator ring to show (priority is resolved upstream). */
  ring: VideoFrameRing;
  /**
   * Ref to the hidden <audio autoplay> element. AddressWidget attaches
   * the remote stream here so audio plays — `<sw-call-media>` hard-codes
   * its video element as `muted` for Chrome's autoplay policy, which
   * silences audio going through that element alone.
   */
  audioRef: Ref<HTMLAudioElement>;
}

export const videoFrameStyles = css`
  .video-frame {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: clamp(12px, 3vw, 32px);
    /* Leave room at the bottom for the floating controls dock. */
    padding-bottom: clamp(96px, 14vh, 140px);
  }

  .video-frame-inner {
    position: relative;
    width: 100%;
    max-width: min(100%, 1280px);
    aspect-ratio: 16 / 9;
    border-radius: var(--sw-address-radius);
    overflow: hidden;
    background: #000;
    box-shadow:
      0 1px 0 rgba(255, 255, 255, 0.03) inset,
      var(--sw-address-shadow-lg);
  }

  /* Ring layer — absolute-positioned outline that pulses per state.
     Sits above the frame via ::after so it animates without shifting the
     video. Single element repurposed across states to keep DOM lean. */
  .video-frame-inner::after {
    content: '';
    position: absolute;
    inset: -1px;
    border-radius: inherit;
    pointer-events: none;
    box-shadow: 0 0 0 0 transparent;
    transition: box-shadow 400ms var(--sw-address-ease);
    border: 1px solid rgba(255, 255, 255, 0.06);
  }

  .video-frame-inner[data-ring='ai-speaking']::after {
    animation: ring-pulse-positive 2.2s ease-in-out infinite;
    border-color: rgba(64, 224, 208, 0.55);
  }

  .video-frame-inner[data-ring='network-warning']::after {
    animation: ring-pulse-warning 1.6s ease-in-out infinite;
    border-color: rgba(255, 215, 0, 0.55);
  }

  .video-frame-inner[data-ring='reconnecting']::after {
    animation: ring-shimmer-recover 1.2s ease-in-out infinite;
    border-color: rgba(247, 42, 114, 0.7);
  }

  @keyframes ring-pulse-positive {
    0%,
    100% {
      box-shadow: 0 0 0 0 rgba(64, 224, 208, 0);
    }
    50% {
      box-shadow: 0 0 28px 2px rgba(64, 224, 208, 0.35);
    }
  }

  @keyframes ring-pulse-warning {
    0%,
    100% {
      box-shadow: 0 0 0 0 rgba(255, 215, 0, 0);
    }
    50% {
      box-shadow: 0 0 24px 2px rgba(255, 215, 0, 0.35);
    }
  }

  @keyframes ring-shimmer-recover {
    0% {
      box-shadow: 0 0 0 0 rgba(247, 42, 114, 0.6);
    }
    50% {
      box-shadow: 0 0 32px 3px rgba(247, 42, 114, 0.45);
    }
    100% {
      box-shadow: 0 0 0 0 rgba(247, 42, 114, 0.0);
    }
  }

  /* Poster layer — shown when there is no call yet. */
  .poster {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: var(--sw-address-bg-surface);
    padding: 5% 8%;
    gap: 20px;
    isolation: isolate;
  }

  .poster::before {
    /* Soft breathing fuchsia glow behind the poster image. */
    content: '';
    position: absolute;
    inset: 10%;
    background: radial-gradient(
      closest-side,
      rgba(247, 42, 114, 0.22) 0%,
      rgba(247, 42, 114, 0.06) 55%,
      rgba(247, 42, 114, 0) 80%
    );
    filter: blur(12px);
    animation: poster-breathe 4s ease-in-out infinite;
    z-index: 0;
  }

  .poster img {
    position: relative;
    z-index: 1;
    max-width: 80%;
    max-height: 70%;
    object-fit: contain;
    user-select: none;
    -webkit-user-drag: none;
  }

  .poster-label {
    position: relative;
    z-index: 1;
    font-family: var(--sw-address-font-code);
    font-size: 12px;
    letter-spacing: var(--sw-address-letter-spacing-eyebrow);
    text-transform: uppercase;
    color: var(--sw-address-fg-muted);
  }

  @keyframes poster-breathe {
    0%,
    100% {
      transform: scale(1);
      opacity: 0.85;
    }
    50% {
      transform: scale(1.06);
      opacity: 1;
    }
  }

  /* sw-call-media theme overrides: match the container's radius and let
     @signalwire/web-components render inside the rounded frame without
     drawing its own background. Full brand alignment lives in
     src/brand/overrides.ts (task #17). */
  sw-call-media {
    width: 100%;
    height: 100%;
    --sw-color-background: #000000;
    --sw-border-radius: 0px;
  }

  @media (max-width: 767px) {
    /* Anchor to the top of the flex column — no centering, no bottom
       padding; the overlay-body flex layout takes care of reserving
       space for the controls dock. */
    .video-frame {
      flex: 0 0 auto;
      display: block;
      padding: 0;
      padding-bottom: 0;
      height: auto;
    }
    .video-frame-inner {
      width: 100%;
      border-radius: 0;
      box-shadow: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .video-frame-inner[data-ring]::after {
      animation: none !important;
    }
    .poster::before {
      animation: none !important;
    }
  }
`;

export function renderVideoFrame(ctx: VideoFrameContext): TemplateResult {
  return html`
    <div part="video-frame" class="video-frame">
      <div class="video-frame-inner" data-ring=${ctx.ring}>
        ${ctx.call
          ? html`<sw-call-media .call=${ctx.call}>
              <sw-participants>
                <sw-self-media mirror></sw-self-media>
              </sw-participants>
            </sw-call-media>`
          : html`<div class="poster">
              <img src=${DEFAULT_POSTER_URL} alt="SignalWire" />
              <div class="poster-label">Connecting call</div>
            </div>`}
      </div>
      <!-- Hidden audio sink. sw-call-media's <video muted> plays picture only;
           the remote stream's audio plays through this element instead. -->
      <audio
        ${ref(ctx.audioRef)}
        autoplay
        playsinline
        aria-hidden="true"
        style="display:none"
      ></audio>
    </div>
  `;
}
