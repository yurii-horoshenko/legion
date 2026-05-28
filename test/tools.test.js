"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const tools = require("../lib/tools");

function tmpRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tools-"));
  fs.writeFileSync(path.join(root, "a.txt"), "hello world\nsecond line");
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "index.js"), "function main() { return 42; }");
  return root;
}

test("Read returns file contents, jailed to root", () => {
  const root = tmpRoot();
  assert.match(tools.execute("Read", { path: "a.txt" }, { root }).result, /hello world/);
});

test("path traversal is blocked", () => {
  const root = tmpRoot();
  const r = tools.execute("Read", { path: "../../../etc/passwd" }, { root });
  assert.equal(r.ok, false);
  assert.match(r.error, /escapes project root/);
});

test("Write then Read round-trips", () => {
  const root = tmpRoot();
  assert.ok(tools.execute("Write", { path: "out/new.md", content: "# Hi" }, { root }).ok);
  assert.equal(tools.execute("Read", { path: "out/new.md" }, { root }).result, "# Hi");
});

test("Edit replaces text", () => {
  const root = tmpRoot();
  assert.ok(tools.execute("Edit", { path: "a.txt", old: "hello", new: "goodbye" }, { root }).ok);
  assert.match(tools.execute("Read", { path: "a.txt" }, { root }).result, /goodbye world/);
  assert.equal(tools.execute("Edit", { path: "a.txt", old: "NOPE", new: "x" }, { root }).ok, false);
});

test("LS lists directory entries", () => {
  const root = tmpRoot();
  const r = tools.execute("LS", { path: "." }, { root }).result;
  assert.match(r, /a\.txt/);
  assert.match(r, /src\//);
});

test("Glob matches by pattern", () => {
  const root = tmpRoot();
  const r = tools.execute("Glob", { pattern: "**/*.js" }, { root }).result;
  assert.match(r, /src\/index\.js/);
});

test("Grep finds matching lines with file:line", () => {
  const root = tmpRoot();
  const r = tools.execute("Grep", { pattern: "second" }, { root }).result;
  assert.match(r, /a\.txt:2:/);
});

test("unknown tool returns error", () => {
  assert.equal(tools.execute("Bash", { cmd: "rm -rf /" }, { root: tmpRoot() }).ok, false);
});

test("describe lists only allowed tools + protocol", () => {
  const d = tools.describe(new Set(["Read", "LS"]));
  assert.match(d, /Read, LS/);
  assert.match(d, /%%TOOL%%/);
  assert.ok(!/Write/.test(d.split("Signatures")[0]));
});
