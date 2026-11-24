import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NO_QUESTION, answerQuestion, answerQuestions, answerValue, answersMessage, questionOf, questionSetKey, questionsOf } from '../../web/src/dispatch/lib/question.ts';

test('no question in an answer that asks nothing', () => {
  assert.equal(questionOf(''), null);
  assert.equal(questionOf(null), null);
  assert.equal(questionOf('테스트를 고쳤어요.\n모두 통과해요.'), null);
});

test('a plain yes/no ask offers yes and no', () => {
  const q = questionOf('브랜치를 만들었어요.\n이대로 PR을 열까요?');
  assert.deepEqual(q, { summary: '이대로 PR을 열까요?', options: ['네, 진행해 주세요', '아니요, 멈춰 주세요'] });
});

test('an open question offers no options', () => {
  assert.deepEqual(questionOf('어떤 이름으로 할까요?')?.options, []);
});

test('a list after the question becomes the options, labels cut at the explanation', () => {
  const q = questionOf('**어느 쪽으로 갈까요?**\n1. A안 — 빠름\n2. B안: 안전함');
  assert.equal(q?.summary, '어느 쪽으로 갈까요?');
  assert.deepEqual(q?.options, ['A안', 'B안']);
});

test('a list right before the question is used too', () => {
  const q = questionOf('- 하나\n- 둘\n- 셋\n어느 걸로 할까요?');
  assert.deepEqual(q?.options, ['하나', '둘', '셋']);
});

test('options are capped at five and deduplicated', () => {
  const q = questionOf(['골라 주세요', ...['a', 'b', 'a', 'c', 'd', 'e', 'f'].map(x => `- ${x}`)].join('\n'));
  assert.deepEqual(q?.options, ['a', 'b', 'c', 'd', 'e']);
});

test('answerQuestion: the transcript first, then the server ask, never empty (#886)', () => {
  const long = `${'보고 '.repeat(300)}\n머지할까요?`;
  assert.equal(answerQuestion({ ask: null }, [{ kind: 'user', text: 'x' }, { kind: 'assistant', text: long }]).summary, '머지할까요?');
  // Transcript not loaded in this tab: the server's ask still shows the question.
  assert.equal(answerQuestion({ ask: 'PR을 열까요?' }, undefined).summary, 'PR을 열까요?');
  // This turn has no assistant text yet (only the user's message): the ask, not an older turn.
  assert.equal(answerQuestion({ ask: '어느 쪽으로 할까요?' }, [{ kind: 'assistant', text: '예전 질문일까요?' }, { kind: 'user', text: 'y' }]).summary, '어느 쪽으로 할까요?');
  // An ask the client reads differently is shown as it is.
  assert.equal(answerQuestion({ ask: '두 가지가 있어요:' }, []).summary, '두 가지가 있어요:');
  assert.deepEqual(answerQuestion({}, []), NO_QUESTION);
});

// #1052: numbered questions ("질문 N/M:") become one tabbed card.
const SET = [
  '정리해 봤어요.',
  '**질문 1/3: 저장 위치는 어디로 할까요?**',
  '1. 워크스페이스 (추천) — 다른 문서와 같이 보여요',
  '2. 홈 폴더 — 프로젝트 밖이에요',
  '',
  '질문 2/3: 어떤 형식을 쓸까요?',
  '1. JSON — 지금과 같아요',
  '2. YAML: 사람이 읽기 쉬워요',
  '3. TOML',
  '질문 3/3: 켤 기능을 여러 개 골라 주세요',
  '- 자동 저장',
  '- 버전 기록',
].join('\n');

test('questionsOf: every numbered question with its options, recommended and reasons', () => {
  const items = questionsOf(SET)!;
  assert.equal(items.length, 3);
  assert.deepEqual(items[0], {
    question: '저장 위치는 어디로 할까요?',
    options: [
      { label: '워크스페이스', reason: '다른 문서와 같이 보여요', recommended: true },
      { label: '홈 폴더', reason: '프로젝트 밖이에요' },
    ],
    multiSelect: false,
  });
  assert.deepEqual(items[1]!.options.map(o => o.label), ['JSON', 'YAML', 'TOML']);
  assert.equal(items[2]!.multiSelect, true);
  assert.deepEqual(items[2]!.options.map(o => o.label), ['자동 저장', '버전 기록']);
});

test('questionsOf: none without numbered questions; a later 질문 1/… starts over', () => {
  assert.equal(questionsOf('어느 쪽으로 갈까요?\n1. A\n2. B'), null);
  assert.equal(questionsOf(null), null);
  const again = questionsOf('질문 1/2: 옛 질문?\n1. a\n2. b\n질문 1/1: 새 질문?\n1. c\n2. d')!;
  assert.deepEqual(again.map(q => q.question), ['새 질문?']);
});

test('questionOf still reads the last question alone (the single-question card)', () => {
  assert.deepEqual(questionOf('어느 쪽으로 갈까요?\n1. A안 — 빠름\n2. B안')?.options, ['A안', 'B안']);
});

test('answersMessage: one block per question, picks and the typed answer joined', () => {
  const items = questionsOf(SET)!;
  const msg = answersMessage(items, [
    { picked: ['워크스페이스'], other: '' },
    { picked: [], other: ' INI ' },
    { picked: ['자동 저장', '버전 기록'], other: '' },
  ]);
  assert.equal(msg, '질문 1/3: 저장 위치는 어디로 할까요?\n답: 워크스페이스\n\n질문 2/3: 어떤 형식을 쓸까요?\n답: INI\n\n질문 3/3: 켤 기능을 여러 개 골라 주세요\n답: 자동 저장, 버전 기록');
  assert.equal(answerValue(undefined), '');
});

test('answerQuestions: the transcript first, then the server ask', () => {
  assert.equal(answerQuestions({ ask: null }, [{ kind: 'assistant', text: SET }])?.length, 3);
  assert.equal(answerQuestions({ ask: '질문 1/1: 진행할까요?\n1. 네\n2. 아니요' }, undefined)?.length, 1);
  assert.equal(answerQuestions({ ask: null }, [{ kind: 'assistant', text: SET }, { kind: 'user', text: '답' }]), null);
});

test('questionSetKey: a new request (turn) gets a new key even when the questions repeat', () => {
  const set = questionsOf('질문 1/2: 어떤 이름으로 할까요?\n질문 2/2: 어디에 둘까요?')!;
  assert.ok(set);
  assert.equal(questionSetKey({ turns: 3 }, set), questionSetKey({ turns: 3 }, set));
  assert.notEqual(questionSetKey({ turns: 3 }, set), questionSetKey({ turns: 4 }, set));
});
