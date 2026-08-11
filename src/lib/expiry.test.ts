/**
 * The idle clock's thresholds — the part with real off-by-one and clock-skew
 * risk. Ported from the standalone chat widget's `tests/expiry.test.js`, which
 * was a hand-rolled runner; the assertions are the same, so this stays the
 * behavioral spec for a mechanism whose failure mode is silence.
 */
import { describe, it, expect } from 'vitest';
import { isIdleExpired, DEFAULT_TIMEOUT_SECONDS } from './expiry';

const T0 = 1_000_000_000_000; // fixed, so the test never depends on the wall clock
const HOUR = 3600;

describe('isIdleExpired', () => {
  describe('thresholds', () => {
    it('a fresh conversation is not expired', () => {
      expect(isIdleExpired(T0, HOUR, T0)).toBe(false);
    });

    it('one second short is not expired', () => {
      expect(isIdleExpired(T0, HOUR, T0 + HOUR * 1000 - 1000)).toBe(false);
    });

    it('exactly at the timeout IS expired (warn early, not late)', () => {
      expect(isIdleExpired(T0, HOUR, T0 + HOUR * 1000)).toBe(true);
    });

    it('well past the timeout is expired', () => {
      expect(isIdleExpired(T0, HOUR, T0 + 5 * HOUR * 1000)).toBe(true);
    });
  });

  describe('disabling', () => {
    it('0 disables the check', () => {
      expect(isIdleExpired(T0, 0, T0 + 10 * HOUR * 1000)).toBe(false);
    });

    it('negative disables the check', () => {
      expect(isIdleExpired(T0, -1, T0 + 10 * HOUR * 1000)).toBe(false);
    });

    it('NaN timeout disables rather than throwing', () => {
      expect(isIdleExpired(T0, NaN, T0 + 10 * HOUR * 1000)).toBe(false);
    });
  });

  describe('clock skew', () => {
    it('a backwards clock jump does not read as fresh forever', () => {
      expect(isIdleExpired(T0, HOUR, T0 - 10 * HOUR * 1000)).toBe(false);
    });

    it('...and still expires once real time passes again', () => {
      expect(isIdleExpired(T0, HOUR, T0 + HOUR * 1000)).toBe(true);
    });

    it('NaN lastActivity does not expire', () => {
      expect(isIdleExpired(NaN, HOUR, T0)).toBe(false);
    });
  });

  describe('default', () => {
    it('matches the chat service DEFAULT_CONVERSATION_TIMEOUT (3600)', () => {
      expect(DEFAULT_TIMEOUT_SECONDS).toBe(3600);
    });

    it('a 59-minute idle under the default is not expired', () => {
      expect(isIdleExpired(T0, DEFAULT_TIMEOUT_SECONDS, T0 + 59 * 60 * 1000)).toBe(false);
    });

    it('a 61-minute idle under the default is expired', () => {
      expect(isIdleExpired(T0, DEFAULT_TIMEOUT_SECONDS, T0 + 61 * 60 * 1000)).toBe(true);
    });
  });
});
