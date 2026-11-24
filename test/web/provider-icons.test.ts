// #621 (E531): one provider id → icon map (react-icons), shared by every view that names a provider.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PROVIDERS } from '../../web/src/modelConnect.ts';
import { PROVIDER_ICONS, providerIcon } from '../../web/src/providerIcons.ts';

test('every provider row has its own icon', () => {
  const icons = PROVIDERS.map((m) => providerIcon(m.id));
  assert.ok(icons.every(Boolean), 'each of Claude, OpenAI Codex, Gemini has a mark');
  assert.equal(new Set(icons).size, PROVIDERS.length, 'no two providers share a mark');
  assert.deepEqual(Object.keys(PROVIDER_ICONS).sort(), PROVIDERS.map((m) => m.id).sort());
});

test('unknown or missing ids have no icon (the name shows alone)', () => {
  for (const id of ['fable', 'toString', '', null, undefined]) assert.equal(providerIcon(id), null, String(id));
});

test('icons are inline SVG in currentColor and can be hidden from assistive tech', () => {
  for (const [id, Icon] of Object.entries(PROVIDER_ICONS)) {
    const svg = renderToStaticMarkup(createElement(Icon, { 'aria-hidden': true, className: 'size-4' }));
    assert.match(svg, /^<svg[^>]*fill="currentColor"/, id);
    assert.match(svg, /aria-hidden="true"/, id);
    assert.doesNotMatch(svg, /https?:\/\/(?!www\.w3\.org)/, `${id}: no remote reference`);
  }
});
