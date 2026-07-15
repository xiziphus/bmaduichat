import { describe, it, expect } from 'vitest';
import { renderMarkdownToHtml } from '@/lib/markdown';

/**
 * The shared renderer must (a) actually format markdown and (b) neutralize XSS.
 * renderToStaticMarkup runs in the node test env with no DOM/jsdom needed.
 */
describe('renderMarkdownToHtml — formatting', () => {
  it('renders bold and italics', () => {
    const html = renderMarkdownToHtml('**bold** and *em*');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>em</em>');
  });

  it('renders headings', () => {
    expect(renderMarkdownToHtml('## Heading')).toContain('<h2>Heading</h2>');
  });

  it('renders bullet lists', () => {
    const html = renderMarkdownToHtml('- a\n- b');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>a</li>');
    expect(html).toContain('<li>b</li>');
  });

  it('renders GFM tables', () => {
    const html = renderMarkdownToHtml('| A | B |\n|---|---|\n| 1 | 2 |');
    expect(html).toMatch(/<table>/);
    expect(html).toContain('<th>A</th>');
    expect(html).toContain('<td>1</td>');
  });

  it('forces safe link attributes', () => {
    const html = renderMarkdownToHtml('[x](https://example.com)');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).toContain('target="_blank"');
  });

  it('does not emit literal markdown asterisks for bold', () => {
    expect(renderMarkdownToHtml('**bold**')).not.toContain('**bold**');
  });
});

describe('renderMarkdownToHtml — XSS sanitization', () => {
  it('escapes raw <script> to inert text (no executable tag)', () => {
    const html = renderMarkdownToHtml('hi <script>alert(1)</script> there');
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain('&lt;script&gt;');
  });

  it('drops javascript: URLs', () => {
    const html = renderMarkdownToHtml('[click](javascript:alert(1))');
    expect(html).not.toContain('javascript:');
  });

  it('never emits an onerror-bearing tag', () => {
    const html = renderMarkdownToHtml('<img src=x onerror=alert(1)>');
    expect(html).not.toMatch(/<img[^>]*onerror/i);
    expect(html).not.toMatch(/<script/i);
  });

  it('does not carry an onerror handler through image markdown syntax', () => {
    const html = renderMarkdownToHtml('![x](http://a.com/x.png)');
    expect(html).not.toMatch(/onerror\s*=/i);
  });
});
