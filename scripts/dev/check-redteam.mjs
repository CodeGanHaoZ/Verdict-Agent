import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const root = "fixtures/redteam/";
const manifest = JSON.parse(readFileSync(root + "manifest.json", "utf8"));
for (const f of manifest.files)
  assert.equal(
    createHash("sha256")
      .update(readFileSync(root + f.file))
      .digest("hex"),
    f.sha256,
    f.file,
  );
const cases = JSON.parse(readFileSync(root + "cases.json", "utf8"));
assert.equal(new Set(cases.map((c) => c.id)).size, cases.length);
const sources = new Set(
  JSON.parse(readFileSync(root + "sources.json", "utf8")).map((s) => s.id),
);
for (const c of cases) assert(sources.has(c.source), c.source);
console.log(
  JSON.stringify({
    version: manifest.version,
    cases: cases.length,
    sourceHashes: "verified",
  }),
);
