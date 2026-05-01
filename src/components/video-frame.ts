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
// Note: we intentionally don't use <sw-self-media>/<sw-participants> — they
// rely on MCU layoutLayers$ to position self, which 1:1 calls without a
// layout don't populate. Instead we render our own <video> overlay bound
// to call.localStream$.
// Side-effect import: registers <sw-call-media> (and the rest of the
// web-components custom elements) via the package's index entry. The
// SDK's exports map currently doesn't expose `./sw-call-media` as a
// deep import path that resolves to the dist filename, so we go through
// the bare entry.
import '@signalwire/web-components';

/**
 * Default SignalWire poster shown before a call is live when no custom
 * poster was supplied. Consumer overrides via the `poster` option/attribute.
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
  /**
   * When false, the video frame collapses entirely. If `poster` is also
   * supplied it shows in a simple centered image; otherwise nothing renders
   * in the video slot (just the audio sink).
   */
  videoEnabled: boolean;
  /**
   * Optional custom poster URL. Overrides the default SignalWire social
   * image. Set to `null` to use the default; empty string means "no poster
   * at all" in audio-only mode.
   */
  poster: string | null;
  /**
   * When false, the local-preview video overlay is omitted from the video
   * frame. The remote video still renders as usual.
   */
  showLocalVideo: boolean;
  /** Ref for the local-preview `<video>` element. AddressWidget attaches
   *  the local MediaStream to it from `call.localStream$`. */
  localVideoRef: Ref<HTMLVideoElement>;
}

export const videoFrameStyles = css`
  .video-frame {
    position: relative;
    flex: 1 1 0;
    min-width: 0;
    min-height: 0;
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

  /* Local-preview overlay. Bottom-right corner of the video frame,
     ~22% wide with a 16:9 aspect ratio. Mirrored for the natural
     front-camera reading experience. Hidden when the caller opted out via
     showLocalVideo=false. */
  .local-preview {
    position: absolute;
    right: 3%;
    bottom: 3%;
    width: 22%;
    min-width: 120px;
    max-width: 220px;
    aspect-ratio: 16 / 9;
    border-radius: var(--sw-address-radius-sm);
    overflow: hidden;
    background: #000;
    border: 1px solid rgba(255, 255, 255, 0.14);
    box-shadow: var(--sw-address-shadow-md);
    z-index: 2;
    pointer-events: none;
  }

  .local-preview video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    /* Mirror so users see a front-facing reflection. */
    transform: scaleX(-1);
    -webkit-transform: scaleX(-1);
    display: block;
  }

  .local-preview[hidden] {
    display: none;
  }

  @media (max-width: 767px) {
    .local-preview {
      right: 8px;
      bottom: 8px;
      width: 28%;
      min-width: 96px;
      max-width: 160px;
    }
  }

  /* Desktop + layout="stacked": the overlay body is flex-column (like
     audio-only and mobile), but the video is still present. We shrink it
     so the transcript that flows underneath has room to breathe. */
  @media (min-width: 768px) {
    :host-context(.overlay-body[data-stacked='true']) .video-frame,
    .overlay-body[data-stacked='true'] .video-frame {
      flex: 0 0 auto;
      display: block;
      padding: clamp(16px, 2.5vw, 28px);
      padding-bottom: 0;
      height: auto;
    }
    .overlay-body[data-stacked='true'] .video-frame-inner {
      max-width: 720px;
      max-height: 48vh;
      margin: 0 auto;
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

  /* Audio-only mode. When the caller opted out of video, we don't render
     the 16:9 frame at all. An optional custom poster becomes a centered
     image at the top of the stacked overlay body; absence of a poster
     collapses the visual area entirely so the overlay shows just the
     controls and any transcript / content drawer. */
  .audio-poster {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: clamp(24px, 6vw, 48px);
    padding-bottom: 0;
    position: relative;
  }

  .audio-poster img {
    max-width: min(420px, 70%);
    max-height: 35vh;
    object-fit: contain;
    user-select: none;
    -webkit-user-drag: none;
    filter: drop-shadow(var(--sw-address-accent-glow));
  }

  @media (max-width: 767px) {
    .audio-poster img {
      max-width: 70%;
      max-height: 28vh;
    }
  }
`;

// The hidden audio sink is always rendered (video on or off) so the
// remote stream's audio plays through a non-muted element.
const audioSink = (r: Ref<HTMLAudioElement>) => html`<audio
  ${ref(r)}
  autoplay
  playsinline
  aria-hidden="true"
  style="display:none"
></audio>`;

export function renderVideoFrame(ctx: VideoFrameContext): TemplateResult {
  // Audio-only: skip the 16:9 frame entirely. Custom poster, if any, becomes
  // the only visual element; otherwise the area collapses.
  if (!ctx.videoEnabled) {
    if (!ctx.poster) {
      return html`${audioSink(ctx.audioRef)}`;
    }
    return html`
      <div part="video-frame" class="audio-poster">
        <img src=${ctx.poster} alt="" />
      </div>
      ${audioSink(ctx.audioRef)}
    `;
  }

  // Video mode. Use custom poster when supplied, falling back to the
  // SignalWire default for the pre-call state.
  const posterUrl = ctx.poster ?? DEFAULT_POSTER_URL;
  return html`
    <div part="video-frame" class="video-frame">
      <div class="video-frame-inner" data-ring=${ctx.ring}>
        ${ctx.call
          ? html`<sw-call-media .call=${ctx.call}></sw-call-media>`
          : html`<div class="poster">
              <img src=${posterUrl} alt="" />
              <div class="poster-label">Connecting call</div>
            </div>`}
        <!-- Local self-preview. Shown only when the call is active and
             the caller didn't opt out via showLocalVideo=false. The video
             element is always in the DOM (hidden) so AddressWidget's
             localStream$ subscription can attach to the ref as soon as
             the stream becomes available. -->
        <div
          class="local-preview"
          part="local-preview"
          ?hidden=${!ctx.call || !ctx.showLocalVideo}
          aria-hidden="true"
        >
          <video
            ${ref(ctx.localVideoRef)}
            autoplay
            playsinline
            muted
            disablepictureinpicture
          ></video>
        </div>
      </div>
      ${audioSink(ctx.audioRef)}
    </div>
  `;
}
