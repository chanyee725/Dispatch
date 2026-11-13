import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pluginDir } from "../plugins.js";
import { SKILL, WEB_ROLES, webGuidance } from "../webguide.js";

// Fake ~/.claude with the given installed_plugins.json content (null = no file).
function home(plugins) {
  const dir = mkdtempSync(join(tmpdir(), "dwg-home-"));
  mkdirSync(join(dir, "plugins"));
  if (plugins) writeFileSync(join(dir, "plugins", "installed_plugins.json"), JSON.stringify({ version: 2, plugins }));
  return dir;
}

const WITH = { "modern-web-guidance@googlechrome": [{ scope: "user", installPath: "/x/modern-web-guidance/1.0.0" }] };
const OTHER = { "i-have-adhd@i-have-adhd": [{ scope: "user", installPath: "/x/i-have-adhd/0.2.0" }] };

test("pluginDir finds an installed plugin by name", () => {
  const h = home({ ...WITH, ...OTHER });
  assert.equal(pluginDir("modern-web-guidance", h), "/x/modern-web-guidance/1.0.0");
  assert.equal(pluginDir("i-have-adhd", h), "/x/i-have-adhd/0.2.0");
  assert.equal(pluginDir("missing", h), null);
});

test("pluginDir is null without the file or with broken JSON", () => {
  assert.equal(pluginDir("modern-web-guidance", home(null)), null);
  const h = home(null);
  writeFileSync(join(h, "plugins", "installed_plugins.json"), "{");
  assert.equal(pluginDir("modern-web-guidance", h), null);
});

test("not installed: no role gets anything", () => {
  for (const h of [home(null), home(OTHER)]) {
    for (const role of ["lead", "impl", "review", "test", "design", "docs"]) {
      assert.equal(webGuidance(role, "claude", h), "");
    }
  }
});

test("installed: implementer, designer and reviewer get the workflow", () => {
  const h = home(WITH);
  for (const role of WEB_ROLES) {
    const p = webGuidance(role, "claude", h);
    assert.match(p, /\[Modern Web Guidance\]/);
    assert.ok(p.includes(SKILL), role);
    assert.match(p, /search → retrieve → 가이드와 코드 대조/);
    assert.match(p, /### Modern Web Guidance/);
    assert.match(p, /CLAUDE\.md\/AGENTS\.md\)이 가이드보다 우선/);
    assert.match(p, /사람 이름/);
    assert.match(p, /웹이 아닌 일에는 쓰지 않는다/);
  }
});

test("installed: tester and docs get nothing, the lead gets the brief rule", () => {
  const h = home(WITH);
  assert.equal(webGuidance("test", "claude", h), "");
  assert.equal(webGuidance("docs", "claude", h), "");
  const lead = webGuidance("lead", "claude", h);
  assert.match(lead, /지시에 넣는다/);
  assert.ok(lead.includes(SKILL));
  assert.match(lead, /### Modern Web Guidance/);
});

test("non-Claude sessions get the npx commands instead of the Skill tool", () => {
  const p = webGuidance("impl", "codex", home(WITH));
  assert.match(p, /npx -y modern-web-guidance@latest search/);
  assert.doesNotMatch(p, /Skill 도구/);
  assert.match(webGuidance("impl", "claude", home(WITH)), /Skill 도구/);
});

test("Codex and Gemini are told to skip offline; Claude wording is unchanged", () => {
  const h = home(WITH);
  for (const provider of ["codex", "gemini"]) {
    const p = webGuidance("impl", provider, h);
    assert.match(p, /네트워크가 있을 때만/);
    assert.match(p, /즉시 건너뛰고/);
    assert.match(p, /sandbox 완화를 하지 말고/);
    assert.match(p, /가이드 조회 불가\(네트워크 없음\)/);
  }
  const c = webGuidance("impl", "claude", h);
  assert.doesNotMatch(c, /조회 불가|건너뛰/);
  assert.match(c, /Skill 도구로/);
  assert.match(webGuidance("lead", "claude", h), /조회 불가"라고 적힌 절은 채워진 것으로 본다/);
});
