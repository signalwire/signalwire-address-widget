import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('UMD bundle', () => {
  it('exposes SignalWireAddressWidget global with mount/unmount/VERSION', () => {
    const path = resolve(__dirname, '..', 'dist', 'address-widget.umd.js');
    const script = readFileSync(path, 'utf8');
    // Execute the IIFE in happy-dom's window context
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function(script).call(window);
    const global = (window as unknown as { SignalWireAddressWidget?: Record<string, unknown> })
      .SignalWireAddressWidget;
    expect(global).toBeDefined();
    expect(typeof global?.mount).toBe('function');
    expect(typeof global?.unmount).toBe('function');
    expect(typeof global?.VERSION).toBe('string');
    expect(customElements.get('signalwire-address')).toBeDefined();
  });
});
