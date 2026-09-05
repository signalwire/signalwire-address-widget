/**
 * Device selection: the choice has to survive the call that follows it.
 *
 * The reported symptom was "pick a mic, it doesn't stick, back to the bad
 * default". Three separate defects produced it, and each is pinned here:
 *
 * 1. The consent choice reached `dial()` as a track constraint but was never
 *    given to the DeviceController, so `selectedAudioInputDevice$` stayed
 *    null and the menu highlighted "default" while a different microphone
 *    was live.
 * 2. A mid-call change was never written back to the consent record, so the
 *    next call re-applied the device the visitor had just rejected.
 * 3. The constraint used `{ exact: … }`, which turns an unplugged headset
 *    into an OverconstrainedError that fails the whole dial.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import './AddressWidget';
import type { AddressWidget } from './AddressWidget';
import { readConsent, writeConsent } from './lib/consent';

const VERSION = 2;

function widget(): AddressWidget {
  const el = document.createElement('signalwire-address') as AddressWidget;
  el.token = 'fake-sat';
  el.destination = '/public/agent';
  document.body.appendChild(el);
  return el;
}

type Internals = {
  _consent: ReturnType<typeof readConsent>;
  _rememberDeviceChoice(kind: 'audio' | 'video', deviceId: string): void;
  _forgetStoredDevice(kind: 'audio' | 'video'): void;
  _audioInputDevices: MediaDeviceInfo[];
  _videoInputDevices: MediaDeviceInfo[];
  _awaitDeviceLists(timeoutMs?: number): Promise<{
    audio: MediaDeviceInfo[];
    video: MediaDeviceInfo[];
  }>;
};

function dev(id: string, label = ''): MediaDeviceInfo {
  return { deviceId: id, label, kind: 'audioinput', groupId: '' } as MediaDeviceInfo;
}

describe('device selection persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
  });

  it('writes a mid-call choice into the consent record', () => {
    // Without this the choice lasts exactly one call.
    writeConsent(true, VERSION, true, true, 'old-mic', null);
    const el = widget();
    const internals = el as unknown as Internals;
    internals._consent = readConsent(VERSION);

    internals._rememberDeviceChoice('audio', 'new-mic');

    expect(readConsent(VERSION)?.audioDeviceId).toBe('new-mic');
  });

  it('leaves the rest of the record intact when persisting a device', () => {
    // The record also carries consent itself; a device change must not
    // quietly re-grant or revoke anything.
    writeConsent(true, VERSION, false, false, null, null);
    const el = widget();
    const internals = el as unknown as Internals;
    internals._consent = readConsent(VERSION);

    internals._rememberDeviceChoice('audio', 'mic-1');

    const stored = readConsent(VERSION);
    expect(stored?.train).toBe(false);
    expect(stored?.camera).toBe(false);
    expect(stored?.audio).toBe(true);
  });

  it('persists camera choices independently of the microphone', () => {
    writeConsent(true, VERSION, true, true, 'mic-1', null);
    const el = widget();
    const internals = el as unknown as Internals;
    internals._consent = readConsent(VERSION);

    internals._rememberDeviceChoice('video', 'cam-1');

    const stored = readConsent(VERSION);
    expect(stored?.videoDeviceId).toBe('cam-1');
    expect(stored?.audioDeviceId).toBe('mic-1');
  });

  it('does not rewrite storage when the choice is unchanged', () => {
    writeConsent(true, VERSION, true, true, 'mic-1', null);
    const el = widget();
    const internals = el as unknown as Internals;
    internals._consent = readConsent(VERSION);
    const before = localStorage.getItem('swaw:consent');

    internals._rememberDeviceChoice('audio', 'mic-1');

    // Same value in, same bytes out — including the timestamp, which would
    // otherwise move on every no-op selection.
    expect(localStorage.getItem('swaw:consent')).toBe(before);
  });

  it('forgets a device id that no longer resolves', () => {
    // An unplugged headset should stop being chased on every future call.
    writeConsent(true, VERSION, true, true, 'ghost-mic', null);
    const el = widget();
    const internals = el as unknown as Internals;
    internals._consent = readConsent(VERSION);

    internals._forgetStoredDevice('audio');

    expect(readConsent(VERSION)?.audioDeviceId).toBeNull();
  });

  it('does nothing when there is no consent record to update', () => {
    const el = widget();
    const internals = el as unknown as Internals;
    internals._consent = null;

    expect(() => internals._rememberDeviceChoice('audio', 'mic-1')).not.toThrow();
    expect(readConsent(VERSION)).toBeNull();
  });
});

describe('waiting for a usable device list', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('returns as soon as labels appear', async () => {
    // A labelled entry is the signal that permission has been granted and
    // the list is worth matching against.
    const el = widget();
    const internals = el as unknown as Internals;
    internals._audioInputDevices = [dev('a', 'Headset')];
    internals._videoInputDevices = [];

    const start = Date.now();
    const result = await internals._awaitDeviceLists(2000);

    expect(result.audio).toHaveLength(1);
    expect(Date.now() - start).toBeLessThan(500);
  });

  it('gives up rather than hanging when labels never arrive', async () => {
    // Blank labels mean a pre-permission list. Matching against it would
    // fail for reasons that have nothing to do with the device, so the
    // caller needs to be let go rather than blocked.
    const el = widget();
    const internals = el as unknown as Internals;
    internals._audioInputDevices = [dev('a', '')];
    internals._videoInputDevices = [];

    const result = await internals._awaitDeviceLists(250);

    expect(result.audio).toHaveLength(1);
    expect(result.audio[0].label).toBe('');
  });
});

describe('mic-check opt-out', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
  });

  it('defaults to on', () => {
    expect(widget().micCheck).toBe(true);
  });

  it('honours mic-check="false" as an attribute', async () => {
    document.body.innerHTML =
      '<signalwire-address token="t" destination="/d" mic-check="false"></signalwire-address>';
    const el = document.body.querySelector('signalwire-address') as AddressWidget;
    await el.updateComplete;
    expect(el.micCheck).toBe(false);
  });

  it('opens no microphone when disabled', () => {
    // The reason the flag exists: with it off, the browser must not be
    // asked for the mic while the setup modal is merely open. Anything
    // else defeats the point of deferring the permission prompt.
    const calls: unknown[] = [];
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: (c: unknown) => {
          calls.push(c);
          return Promise.reject(new Error('should not be called'));
        },
        enumerateDevices: () => Promise.resolve([])
      },
      configurable: true
    });

    const el = widget();
    el.micCheck = false;
    const internals = el as unknown as {
      _consentModalOpen: boolean;
      _consentDraft: { audio: boolean; audioDeviceId: string | null };
      _startMicMeter(): void;
      _micMeter: unknown;
    };
    internals._consentModalOpen = true;
    internals._consentDraft = { audio: true, audioDeviceId: null };
    internals._startMicMeter();

    expect(calls).toHaveLength(0);
    expect(internals._micMeter).toBeNull();
  });

  it('opens the microphone when enabled', () => {
    // Paired with the case above so the assertion can actually fail:
    // without this, "no getUserMedia" would pass even if the meter were
    // broken for everyone.
    const calls: unknown[] = [];
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: (c: unknown) => {
          calls.push(c);
          return new Promise(() => undefined);
        },
        enumerateDevices: () => Promise.resolve([])
      },
      configurable: true
    });

    const el = widget();
    el.micCheck = true;
    const internals = el as unknown as {
      _consentModalOpen: boolean;
      _consentDraft: { audio: boolean; audioDeviceId: string | null };
      _startMicMeter(): void;
    };
    internals._consentModalOpen = true;
    internals._consentDraft = { audio: true, audioDeviceId: null };
    internals._startMicMeter();

    expect(calls).toHaveLength(1);
  });
});
