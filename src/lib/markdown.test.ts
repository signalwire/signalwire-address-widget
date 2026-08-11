import { describe, it, expect } from 'vitest';
import { renderMarkdown } from './markdown';

describe('renderMarkdown', () => {
  it('syntax-highlights fenced code', () => {
    const out = renderMarkdown('```python\ndef hello():\n    return 1\n```');
    expect(out).toContain('code-block');
    // The language label survives; `data-language` does NOT — the sanitizer's
    // ALLOWED_ATTR has no data-* and that is fine, the label is what shows.
    expect(out).toContain('code-block-lang');
    expect(out).toContain('python');
    // Prism emits token spans; the sanitizer allows span + class.
    expect(out).toContain('class="token');
  });

  it('renders gfm tables and lists', () => {
    const out = renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |\n\n- one\n- two');
    expect(out).toContain('<table');
    expect(out).toContain('<ul');
  });

  it('keeps inline code inline', () => {
    const out = renderMarkdown('use `set_params` for that');
    expect(out).toContain('<code>set_params</code>');
    expect(out).not.toContain('code-block');
  });

  it('still strips injected html', () => {
    const out = renderMarkdown('hi <script>alert(1)</script> there');
    expect(out).not.toContain('<script');
  });
});
