// Run: node app/projectImport.check.ts
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { ImportError, MAX_FILE_BYTES, readZip, toProjectFiles } from "./projectImport.ts";

// Minimal zip writer for test input; method 8 = deflate, 0 = stored.
const makeZip = (entries: { path: string; data: Uint8Array; method?: 0 | 8 }[]) => {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const { path, data, method = 8 } of entries) {
    const name = Buffer.from(path);
    const body = method === 8 ? deflateRawSync(data) : Buffer.from(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, dir, end]));
};

const text = (s: string) => new TextEncoder().encode(s);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]);

const zip = makeZip([
  { path: "thesis/chapters/intro.tex", data: text("\\section{Intro}\r\n") },
  { path: "thesis/main.tex", data: text("\uFEFF\\documentclass{article}\n\\input{chapters/intro}") },
  { path: "thesis/refs.bib", data: text("@book{x}"), method: 0 },
  { path: "thesis/figures/plot.png", data: png },
  { path: "thesis/.DS_Store", data: png },
  { path: "__MACOSX/thesis/._main.tex", data: png },
]);

const { files, skipped } = toProjectFiles(await readZip(zip));
assert.deepEqual(files.map((f) => f.name), ["main.tex", "refs.bib", "chapters/intro.tex"], "top folder stripped, main first");
assert.equal(files[0].content, "\\documentclass{article}\n\\input{chapters/intro}", "BOM removed");
assert.equal(files[2].content, "\\section{Intro}\n", "CRLF normalised");
assert.deepEqual(skipped.map((s) => s.name), ["figures/plot.png"], "junk dropped silently, binary reported");

// Zip bomb: tiny compressed entry whose header lies about its size.
const bomb = makeZip([{ path: "big.tex", data: new Uint8Array(MAX_FILE_BYTES * 4).fill(65) }]);
const view = new DataView(bomb.buffer);
const central = bomb.length - 22 - 46 - "big.tex".length;
view.setUint32(central + 24, 10, true);
const bombResult = toProjectFiles(await readZip(bomb));
assert.equal(bombResult.files.length, 0);
assert.match(bombResult.skipped[0].reason, /larger than/);

await assert.rejects(readZip(text("not a zip")), ImportError);

console.log("projectImport ok");
