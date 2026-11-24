import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInline, parseMarkdown } from '../web/src/dispatch/lib/markdown.ts';

test('parseInline: bold, italic, code, link, plain text', () => {
  assert.deepEqual(parseInline('a **근거** b `x` *y* [l](https://e.io)'), [
    { t: 'text', text: 'a ' }, { t: 'bold', text: '근거' }, { t: 'text', text: ' b ' }, { t: 'code', text: 'x' },
    { t: 'text', text: ' ' }, { t: 'italic', text: 'y' }, { t: 'text', text: ' ' }, { t: 'link', text: 'l', href: 'https://e.io' },
  ]);
});

test('parseInline: only http(s) links; markup stays text', () => {
  assert.deepEqual(parseInline('[x](javascript:alert(1)) <b>hi</b>'), [{ t: 'text', text: '[x](javascript:alert(1)) <b>hi</b>' }]);
});

test('parseMarkdown: paragraphs, lists, heading, fence', () => {
  const b = parseMarkdown('# T\nline one\nline two\n\n- a\n- **b**\n\n1. x\n2. y\n\n```js\n- not a list\n```');
  assert.deepEqual(b.map((x) => x.t), ['h', 'p', 'ul', 'ol', 'code']);
  assert.equal((b[2] as { items: unknown[] }).items.length, 2);
  assert.equal((b[4] as { text: string }).text, '- not a list');
});
