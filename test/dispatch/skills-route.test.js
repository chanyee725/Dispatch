// GET /api/skills (#968 s2): installed skill names and descriptions for the chat's "/" menu, nothing else.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { listSkills, routeTable, skillMeta } from "../../server/dispatch/routes.js";

const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = mkdtempSync(path.join(tmpdir(), "drawing-skills-")); dirs.push(d); return d; };
const skill = (dir, folder, front, body = "Secret body text.") => {
  mkdirSync(path.join(dir, folder), { recursive: true });
  writeFileSync(path.join(dir, folder, "SKILL.md"), `---\n${front}\n---\n\n${body}\n`);
};

test("skillMeta: name and one-line description from the front matter only", () => {
  assert.deepEqual(skillMeta("---\nname: a-b\ndescription: \"Does a thing\"\n---\nbody"), { name: "a-b", description: "Does a thing" });
  assert.deepEqual(skillMeta("---\nname: x\ndescription: >\n  folded\n---\n"), { name: "x", description: "" });
  assert.equal(skillMeta("no front matter"), null);
  assert.equal(skillMeta("---\nname: ../evil path\n---\n"), null);
  assert.equal(skillMeta("---\nname: long\ndescription: " + "d".repeat(500) + "\n---\n").description.length, 200);
});

test("GET /api/skills lists project and user skills, project first on a clash, no paths or bodies", async () => {
  const project = tmp(), user = tmp();
  skill(project, "deploy", "name: deploy\ndescription: Project deploy");
  skill(user, "deploy", "name: deploy\ndescription: User deploy");
  skill(user, "review", "name: review\ndescription: Review code");
  skill(user, ".hidden", "name: hidden\ndescription: no");
  mkdirSync(path.join(user, "not-a-skill"));
  const table = routeTable({ root: "/x", store: {}, hub: {}, models: [], broadcast: () => {}, skillDirs: [project, user, path.join(user, "missing")] });
  const entry = table.find(([m, re]) => m === "GET" && re.test("/api/skills"));
  const res = await entry[2]([], {});
  assert.deepEqual(res, { skills: [{ name: "deploy", description: "Project deploy" }, { name: "review", description: "Review code" }] });
  const raw = JSON.stringify(res);
  assert.doesNotMatch(raw, /Secret body|drawing-skills-|SKILL\.md/);
});

test("listSkills: no skill folders at all is an empty list", async () => {
  assert.deepEqual(await listSkills([path.join(tmp(), "none")]), []);
});
