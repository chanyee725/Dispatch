// 설정 modal's 모델 연결 + 역할별 모델 section (#624): model groups and role warnings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelGroups, roleChoice, subjParticle } from '../../web/src/settings/sections/modelsSection.ts';

const models = [
  { id: 'gpt-x', label: 'GPT X', provider: 'openai' },
  { id: 'claude-opus-5-5', label: 'Opus 5.5', provider: 'claude' },
  { id: 'gemini-y', label: 'Gemini Y', provider: 'gemini' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', provider: 'claude' },
  { id: 'other-z', label: 'Z', provider: 'zeta' },
];
const providers = { claude: { connected: true }, openai: { connected: false }, zeta: { name: 'Zeta', connected: true } };

test('modelGroups puts providers in PROVIDERS order, unknown ones last, keeping model order', () => {
  const g = modelGroups(models, providers);
  assert.deepEqual(g.map((x) => x.provider), ['claude', 'openai', 'gemini', 'zeta']);
  assert.deepEqual(g[0].models.map((m) => m.id), ['claude-opus-5-5', 'claude-sonnet-5-5']);
  assert.deepEqual(g.map((x) => x.name), ['Claude', 'OpenAI Codex', 'Gemini', 'Zeta']);
  // Every known provider shows even with no models, so it can be connected from the list.
  assert.deepEqual(modelGroups([], providers).map((x) => [x.provider, x.models.length]), [['claude', 0], ['openai', 0], ['gemini', 0]]);
});

test('roleChoice warns for an unlisted model and for a provider that is not connected', () => {
  assert.deepEqual(roleChoice('claude-opus-5-5', models, providers), { provider: 'claude', warn: null });
  const off = roleChoice('gpt-x', models, providers);
  assert.equal(off.provider, 'openai');
  assert.match(off.warn!, /^OpenAI Codex가 연결되지 않았어요/);
  assert.match(roleChoice('gemini-y', models, providers).warn!, /^Gemini가 /);
  const gone = roleChoice('old-model', models, providers);
  assert.equal(gone.provider, null);
  assert.match(gone.warn!, /목록에 없는 모델/);
});

test('subjParticle picks 이 after a final consonant', () => {
  assert.equal(subjParticle('Claude'), '가');
  assert.equal(subjParticle('제미닌'), '이');
  assert.equal(subjParticle('코덱스'), '가');
});

