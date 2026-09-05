/**
 * MicLevelMeter: the pre-call microphone check.
 *
 * Two properties matter more than the metering itself.
 *
 * **It must release what it opens.** Every meter holds a MediaStream and an
 * AudioContext, and browsers cap concurrent AudioContexts at a handful — a
 * leak per device change would make the picker stop metering after a few
 * switches, which looks precisely like the microphone failing. That includes
 * the race where `stop()` lands while `getUserMedia` is still in flight.
 *
 * **Silence must be distinguishable from not-started-yet.** The whole reason
 * this exists is that a dead microphone is indistinguishable from a working
 * one through every other API, so the silence verdict has to be trustworthy.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MicLevelMeter } from './mic-level';

class FakeTrack {
  stopped = false;
  stop(): void {
    this.stopped = true;
  }
}

class FakeStream {
  tracks: FakeTrack[] = [new FakeTrack()];
  getTracks(): FakeTrack[] {
    return this.tracks;
  }
}

let closed = 0;
let created = 0;
let sampleValue = 0;

class FakeAnalyser {
  fftSize = 512;
  connect(): void {}
  getFloatTimeDomainData(buf: Float32Array): void {
    buf.fill(sampleValue);
  }
}

class FakeAudioContext {
  constructor() {
    created++;
  }
  createMediaStreamSource(): { connect(n: unknown): void } {
    return { connect: () => undefined };
  }
  createAnalyser(): FakeAnalyser {
    return new FakeAnalyser();
  }
  close(): Promise<void> {
    closed++;
    return Promise.resolve();
  }
}

function installMediaMocks(opts: { deny?: boolean; delayMs?: number } = {}): FakeStream {
  const stream = new FakeStream();
  const getUserMedia = vi.fn(async () => {
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    if (opts.deny) throw new Error('NotAllowedError');
    return stream as unknown as MediaStream;
  });
  Object.defineProperty(globalThis, 'navigator', {
    value: { mediaDevices: { getUserMedia } },
    configurable: true,
    writable: true
  });
  (globalThis as unknown as { window: unknown }).window = {
    AudioContext: FakeAudioContext
  };
  (globalThis as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame = (
    fn: FrameRequestCallback
  ) => setTimeout(() => fn(0), 1) as unknown as number;
  (globalThis as unknown as { cancelAnimationFrame: unknown }).cancelAnimationFrame = (
    id: number
  ) => clearTimeout(id);
  return stream;
}

describe('MicLevelMeter', () => {
  beforeEach(() => {
    closed = 0;
    created = 0;
    sampleValue = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('resource release', () => {
    it('stops the media track and closes the context', async () => {
      const stream = installMediaMocks();
      const meter = new MicLevelMeter({ deviceId: null, onLevel: () => undefined });
      await meter.start();
      expect(created).toBe(1);

      meter.stop();
      expect(stream.tracks[0].stopped).toBe(true);
      expect(closed).toBe(1);
    });

    it('releases a stream that arrives after stop() was called', async () => {
      // The modal closing mid-permission-prompt. Without the guard the
      // stream is adopted by nobody and the browser's recording indicator
      // stays lit with no UI to explain it.
      const stream = installMediaMocks({ delayMs: 20 });
      const meter = new MicLevelMeter({ deviceId: null, onLevel: () => undefined });
      const starting = meter.start();
      meter.stop();
      await starting;

      expect(stream.tracks[0].stopped).toBe(true);
      expect(created).toBe(0); // never built a context for a dead meter
    });

    it('is safe to stop twice', async () => {
      installMediaMocks();
      const meter = new MicLevelMeter({ deviceId: null, onLevel: () => undefined });
      await meter.start();
      meter.stop();
      meter.stop();
      expect(closed).toBe(1);
    });

    it('does not leak a context per restart', async () => {
      // Switching device in the dropdown restarts the meter. Five switches
      // must not leave five contexts open.
      installMediaMocks();
      for (let i = 0; i < 5; i++) {
        const meter = new MicLevelMeter({ deviceId: `dev-${i}`, onLevel: () => undefined });
        await meter.start();
        meter.stop();
      }
      expect(created).toBe(5);
      expect(closed).toBe(5);
    });
  });

  describe('permission failure', () => {
    it('reports the error and opens nothing', async () => {
      installMediaMocks({ deny: true });
      const onError = vi.fn();
      const meter = new MicLevelMeter({ deviceId: null, onLevel: () => undefined, onError });
      await meter.start();

      expect(onError).toHaveBeenCalledOnce();
      expect(created).toBe(0);
      // stop() after a failed start must still be safe.
      expect(() => meter.stop()).not.toThrow();
    });
  });

  describe('device selection', () => {
    it('asks for the device as a preference, never as exact', async () => {
      // `exact` turns a device that has since been unplugged into a hard
      // failure, which would tell the visitor their microphone is broken
      // when only this one is gone.
      installMediaMocks();
      const meter = new MicLevelMeter({ deviceId: 'abc123', onLevel: () => undefined });
      await meter.start();
      const gum = (navigator.mediaDevices.getUserMedia as unknown) as ReturnType<typeof vi.fn>;
      expect(gum).toHaveBeenCalledWith({ audio: { deviceId: 'abc123' }, video: false });
      meter.stop();
    });

    it('falls back to a plain request when no device is chosen', async () => {
      installMediaMocks();
      const meter = new MicLevelMeter({ deviceId: null, onLevel: () => undefined });
      await meter.start();
      const gum = (navigator.mediaDevices.getUserMedia as unknown) as ReturnType<typeof vi.fn>;
      expect(gum).toHaveBeenCalledWith({ audio: true, video: false });
      meter.stop();
    });
  });

  describe('silence detection', () => {
    it('does not call a fresh stream silent', async () => {
      // Silence has to persist; reporting it on the first sample would
      // flag every microphone before the visitor has said a word.
      installMediaMocks();
      sampleValue = 0;
      const meter = new MicLevelMeter({ deviceId: null, onLevel: () => undefined });
      await meter.start();
      await new Promise((r) => setTimeout(r, 30));
      expect(meter.silent).toBe(false);
      meter.stop();
    });

    it('reports a level above zero for a signal', async () => {
      installMediaMocks();
      sampleValue = 0.5;
      const levels: number[] = [];
      const meter = new MicLevelMeter({ deviceId: null, onLevel: (l) => levels.push(l) });
      await meter.start();
      await new Promise((r) => setTimeout(r, 30));
      meter.stop();

      expect(levels.length).toBeGreaterThan(0);
      expect(Math.max(...levels)).toBeGreaterThan(0);
    });

    it('clears silence as soon as signal returns', async () => {
      installMediaMocks();
      sampleValue = 0;
      const meter = new MicLevelMeter({ deviceId: null, onLevel: () => undefined });
      await meter.start();
      await new Promise((r) => setTimeout(r, 20));
      sampleValue = 0.4;
      await new Promise((r) => setTimeout(r, 20));
      expect(meter.silent).toBe(false);
      meter.stop();
    });
  });
});
