/**
 * Live microphone level metering for the pre-call setup screen.
 *
 * Why this exists: a microphone that is present but carries no signal — a
 * virtual device with nothing routed into it, a muted hardware switch, an
 * interface whose input gain is at zero — satisfies `getUserMedia`
 * completely. The track is live, `readyState` is "live", `muted` is false,
 * and every constraint is met. Nothing in the WebRTC API distinguishes it
 * from a working microphone; the only difference is that the samples are all
 * zero. So the only honest way to tell a visitor their microphone is dead is
 * to show them the samples.
 *
 * This runs BEFORE the call, on purpose. Discovering it mid-call means the
 * agent has already greeted someone it cannot hear.
 *
 * Lifetime: every meter owns exactly one `MediaStream` and one
 * `AudioContext`, and `stop()` releases both. Browsers cap concurrent
 * AudioContexts (Chrome at ~6), so a leaked one per device change would make
 * the picker stop working after a handful of switches — `stop()` is not
 * optional tidiness.
 */

/** A level sample, 0..1, already smoothed for display. */
export type LevelListener = (level: number) => void;

export interface MicLevelOptions {
  /** Device to open, or null for the browser default. */
  deviceId: string | null;
  /** Called roughly every animation frame with a 0..1 level. */
  onLevel: LevelListener;
  /** Called when the microphone could not be opened at all. */
  onError?: (err: unknown) => void;
}

/**
 * Below this RMS the input is treated as silence.
 *
 * Not zero: a real microphone in a quiet room still produces dither and
 * self-noise in the 1e-4 range, and a threshold of exactly zero would call
 * every quiet room "no signal". Chosen to sit above that floor and well
 * below speech.
 */
const SILENCE_RMS = 0.002;

/** Seconds of continuous silence before a stream is reported as dead. */
const SILENCE_SECONDS = 3;

export class MicLevelMeter {
  private _stream: MediaStream | null = null;
  private _ctx: AudioContext | null = null;
  private _raf: number | null = null;
  private _stopped = false;
  private _silentSince: number | null = null;
  private _smoothed = 0;

  /** True once the input has been continuously silent for SILENCE_SECONDS. */
  public silent = false;

  constructor(private readonly opts: MicLevelOptions) {}

  async start(): Promise<void> {
    try {
      // A plain preference, never `{ exact: … }`: this is a preview, and
      // failing it outright would tell the visitor their microphone is
      // broken when the truth is only that this particular one has gone.
      this._stream = await navigator.mediaDevices.getUserMedia({
        audio: this.opts.deviceId ? { deviceId: this.opts.deviceId } : true,
        video: false
      });
      if (this._stopped) {
        // stop() was called while getUserMedia was in flight. Without this
        // the stream stays open with no owner and the recording indicator
        // stays lit after the modal has closed.
        this._releaseStream();
        return;
      }

      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this._ctx = new Ctor();
      const source = this._ctx.createMediaStreamSource(this._stream);
      const analyser = this._ctx.createAnalyser();
      // Small FFT: this drives a bar, not a spectrogram, and a smaller
      // buffer means the meter reacts quickly enough to feel live.
      analyser.fftSize = 512;
      source.connect(analyser);
      // Deliberately NOT connected to the destination — routing the
      // microphone to the speakers would give the visitor a feedback howl.

      const buffer = new Float32Array(analyser.fftSize);
      const tick = (): void => {
        if (this._stopped || !this._ctx) return;
        analyser.getFloatTimeDomainData(buffer);

        let sum = 0;
        for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
        const rms = Math.sqrt(sum / buffer.length);

        this._trackSilence(rms);

        // Perceptual-ish curve and asymmetric smoothing: rise fast so
        // speaking registers immediately, fall slowly so the bar does not
        // strobe between syllables.
        const scaled = Math.min(1, Math.sqrt(rms) * 3);
        this._smoothed =
          scaled > this._smoothed
            ? scaled
            : this._smoothed + (scaled - this._smoothed) * 0.15;

        this.opts.onLevel(this._smoothed);
        this._raf = requestAnimationFrame(tick);
      };
      this._raf = requestAnimationFrame(tick);
    } catch (err) {
      this.opts.onError?.(err);
    }
  }

  private _trackSilence(rms: number): void {
    if (rms > SILENCE_RMS) {
      this._silentSince = null;
      this.silent = false;
      return;
    }
    const now = Date.now();
    if (this._silentSince === null) {
      this._silentSince = now;
      return;
    }
    if (!this.silent && now - this._silentSince > SILENCE_SECONDS * 1000) {
      this.silent = true;
    }
  }

  private _releaseStream(): void {
    if (!this._stream) return;
    for (const track of this._stream.getTracks()) track.stop();
    this._stream = null;
  }

  /** Release the microphone and the audio context. Safe to call twice. */
  stop(): void {
    this._stopped = true;
    if (this._raf !== null) {
      cancelAnimationFrame(this._raf);
      this._raf = null;
    }
    this._releaseStream();
    if (this._ctx) {
      // close() returns a promise; a failure here means the context was
      // already closed, which is the state we wanted anyway.
      void this._ctx.close().catch(() => undefined);
      this._ctx = null;
    }
  }
}
