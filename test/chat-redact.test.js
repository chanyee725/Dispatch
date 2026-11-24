// Saved chat history goes through chatRedact (#968): every pattern below is masked, ordinary
// prose, relative paths, URLs and dates stay. All values are made up and built from parts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { IMAGE, MASK, chatRedact, chatRedactDeep } from "../server/dispatch/chat-redact.js";

const masked = (input, expected) => assert.equal(chatRedact(input), expected, input);
const hidden = (input, secret) => {
  const out = chatRedact(input);
  assert.ok(!out.includes(secret), `${input} -> ${out}`);
  assert.ok(out.includes(MASK) || out.includes(IMAGE), `${input} -> ${out}`);
};

test("emails, including SSH remotes and URL credentials", () => {
  masked(`mail ${["someone", "example.com"].join("@")} now`, `mail ${MASK} now`);
  masked(["git", "example.com:owner/repo.git"].join("@"), MASK);
  masked("postgres://fakeuser:fakepass@db.example.com/app", `postgres://${MASK}@db.example.com/app`);
});

test("phone numbers and other long numbers; dates and short numbers stay", () => {
  masked("call 010-0000-0000 now", `call ${MASK} now`);
  masked("call 01000000000", `call ${MASK}`);
  masked("+82 10 0000 0000", MASK);
  masked("(555) 000-0000", MASK);
  hidden("card 4000 0000 0000 0000", "4000");
  hidden("id 000000-3000000", "3000000");
  masked("on 2026-11-20 14:30, PR #968 v1.2.3", "on 2026-11-20 14:30, PR #968 v1.2.3");
});

test("tokens and API keys: known prefixes, JWTs, PEM, assignments and unprefixed random runs", () => {
  const key = ["sk", "ant", "api03", "x".repeat(24)].join("-");
  masked(`key ${key} end`, `key ${MASK} end`);
  masked(`gh ${"ghp_" + "a1".repeat(15)}`, `gh ${MASK}`);
  masked("Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345", `Authorization: Bearer ${MASK}`);
  masked("client_secret=abcd1234", `client_secret=${MASK}`);
  masked("cookie: sid-fake-value", `cookie: ${MASK}`);
  // Short values after a secret-like key, any length; the key name stays.
  masked("password: fake1", `password: ${MASK}`);
  masked("secret: abcd", `secret: ${MASK}`);
  masked("token=abc123", `token=${MASK}`);
  masked("Passwd=x and pwd: ab", `Passwd=${MASK} and pwd: ${MASK}`);
  masked("api key: zz", `api key: ${MASK}`);
  masked('{"api_key": "ab"}', `{"api_key": "${MASK}"}`);
  masked("tokens: 12", "tokens: 12");
  masked(`-----BEGIN ${"PRIVATE"} KEY-----\nAAAA\n-----END ${"PRIVATE"} KEY-----`, MASK);
  masked("tok Zx9aB3kq7Lm2Pq8Rt5Wv", `tok ${MASK}`);
  masked("sha 0123456789abcdef0123456789abcdef01234567", `sha ${MASK}`);
  masked("id 00000000-0000-4000-8000-000000000000", `id ${MASK}`);
  // Word-like branch and file names are not tokens.
  masked("feat/968-chat-store-masking-extra", "feat/968-chat-store-masking-extra");
});

test("absolute and home paths; relative paths, short API paths and URLs stay", () => {
  masked("see /home/fakeuser/proj/a.js:12", `see ${MASK}:12`);
  masked("/Users/fakeuser/x", MASK);
  masked("/tmp", MASK);
  masked("cd ~/code/app", `cd ${MASK}`);
  masked("in $HOME/.config/x", `in ${MASK}`);
  masked("C:\\Users\\fakeuser\\a.txt", MASK);
  masked("C:/Users/fakeuser/a.txt", MASK);
  masked("open D:/work/a.txt now", `open ${MASK} now`);
  masked("see https://example.com/a", "see https://example.com/a");
  masked("\\\\server\\share\\a", MASK);
  masked("file:///srv/x", MASK);
  masked("/opt/a/b/c and /x/y/z", `${MASK} and ${MASK}`);
  masked("read server/dispatch/chat-store.js", "read server/dispatch/chat-store.js");
  masked("GET /api/file", "GET /api/file");
  masked("see https://example.com/a/b/c", "see https://example.com/a/b/c");
});

test("name-like words: Korean titles, introductions, name fields, greetings, @handles", () => {
  masked("김가짜님 안녕하세요", `${MASK}님 안녕하세요`);
  masked("박가짜 씨", `${MASK} 씨`);
  masked("관리자님, 사용자님", "관리자님, 사용자님");
  hidden("제 이름은 홍가짜예요", "홍가짜");
  masked("저는 이가짜입니다", `저는 ${MASK}입니다`);
  masked("이름: 최가짜", `이름: ${MASK}`);
  masked("Hi Fakename, thanks", `Hi ${MASK}, thanks`);
  masked("my name is Fake Person.", `my name is ${MASK}.`);
  masked("Author: Fake Person", `Author: ${MASK}`);
  masked("Dr. Fakename said", `${MASK} said`);
  masked("ping @fake-login and use @types/node", `ping ${MASK} and use @types/node`);
});

test("name rules: any-case name fields, Korean contact keys, by, surname before 입니다/가", () => {
  masked("name: fake person", `name: ${MASK}`);
  masked("NAME = fakeperson", `NAME = ${MASK}`);
  masked('{"name": "fakeuser"}', `{"name": "${MASK}"}`);
  masked("my name is fake person", `my name is ${MASK}`);
  masked("Contact: fake person", `Contact: ${MASK}`);
  masked("담당: 김가짜", `담당: ${MASK}`);
  masked("연락: fake person", `연락: ${MASK}`);
  masked("Written by Fake Person", `Written by ${MASK}`);
  masked("홍가짜입니다", `${MASK}입니다`);
  masked("김가짜가 말했어요", `${MASK}가 말했어요`);
  masked("남궁짜가 왔어요", `${MASK}가 왔어요`);
  // Ordinary words and phrases around the same contexts stay.
  masked("by default it works", "by default it works");
  masked("file name and size", "file name and size");
  masked("구현자가 고쳤어요", "구현자가 고쳤어요");
  masked("문서가 있어요, 정상입니다", "문서가 있어요, 정상입니다");
  // Two-part absolute paths outside the system roots stay on purpose (see chat-redact.js).
  masked("GET /api/file in /work/atelier", "GET /api/file in /work/atelier");
});

test("inline images become a placeholder", () => {
  masked("look data:image/png;base64,iVBORw0KGgoAAAA= here", `look ${IMAGE} here`);
});

test("non-strings pass through; chatRedactDeep masks nested strings, keeps keys", () => {
  assert.equal(chatRedact(""), "");
  assert.equal(chatRedact(null), null);
  assert.equal(chatRedact(3), 3);
  assert.deepEqual(chatRedactDeep({ path: ["/home/fakeuser/a"], n: 1 }), { path: [MASK], n: 1 });
});
