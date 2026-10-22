// Upload: a .zip (whole project, e.g. an Overleaf download) or loose files -> project files.
// Zip is read with the browser's own DecompressionStream; no library needed.

// Mirrors backend defaults (backend/utils/config.py), which still enforce them on save.
export const MAX_FILE_BYTES = 512 * 1024;
export const MAX_FILE_COUNT = 100;
export const MAX_PROJECT_BYTES = 2 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 2000;

// Images \includegraphics can use. Stored as a base64 data URL in `content`; the backend writes the bytes.
const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  pdf: "application/pdf",
  eps: "application/postscript",
};

// What the upload pickers offer: a project .zip, the usual source files and the images above.
export const UPLOAD_ACCEPT = [".zip", ".tex", ".bib", ".sty", ".cls", ".bst", ".txt", ...Object.keys(IMAGE_TYPES).map((ext) => `.${ext}`)].join(",");

// The backend matches the same pattern (services/compiler.py); a real text file never looks like this.
const DATA_URL = /^data:[\w.+-]+\/[\w.+-]+;base64,([A-Za-z0-9+/]*={0,2})$/;

export const isDataUrl = (content: string) => DATA_URL.test(content);

/** The bytes of an uploaded image, or null for a text file. */
export const dataUrlBytes = (content: string) => {
  const base64 = DATA_URL.exec(content)?.[1];
  return base64 === undefined ? null : Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
};

const toDataUrl = (bytes: Uint8Array, type: string) => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(binary)}`;
};

// Anything else is accepted if it decodes as UTF-8 text.
const BINARY_EXTENSIONS = new Set([
  "gif", "bmp", "tif", "tiff", "webp", "ps", "svg", "zip", "gz",
  "ttf", "otf", "woff", "woff2", "aux", "log", "synctex", "fls", "fdb_latexmk", "xdv", "dvi",
]);

export type ImportedFile = { name: string; content: string };
export type ImportResult = { files: ImportedFile[]; skipped: { name: string; reason: string }[] };

const u16 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8);
const u32 = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;

// Inflate, stopping as soon as the output passes `limit` so a zip bomb can't exhaust memory.
const inflateRaw = async (data: Uint8Array, limit: number) => {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
};

export class ImportError extends Error {}

/** Entries larger than MAX_FILE_BYTES come back with `bytes: null` so they can be reported as skipped. */
export const readZip = async (zip: Uint8Array): Promise<{ path: string; bytes: Uint8Array | null }[]> => {
  // End-of-central-directory record: last 22 bytes, plus up to 64 KB of trailing comment.
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (u32(zip, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new ImportError("This isn't a valid .zip file.");

  const count = u16(zip, eocd + 10);
  let at = u32(zip, eocd + 16);
  if (count === 0xffff || at === 0xffffffff) throw new ImportError("Zip64 archives aren't supported. Re-zip the project normally.");
  if (count > MAX_ZIP_ENTRIES) throw new ImportError(`The zip has more than ${MAX_ZIP_ENTRIES} entries.`);

  const decoder = new TextDecoder();
  const entries: { path: string; bytes: Uint8Array | null }[] = [];
  for (let n = 0; n < count; n++) {
    if (u32(zip, at) !== 0x02014b50) throw new ImportError("The zip file is damaged.");
    const flags = u16(zip, at + 8);
    const method = u16(zip, at + 10);
    const compressedSize = u32(zip, at + 20);
    const size = u32(zip, at + 24);
    const nameLength = u16(zip, at + 28);
    const extraLength = u16(zip, at + 30);
    const commentLength = u16(zip, at + 32);
    const localHeader = u32(zip, at + 42);
    const path = decoder.decode(zip.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;

    if (path.endsWith("/")) continue; // directory
    if (flags & 1) throw new ImportError("Password-protected zips aren't supported.");
    if (size > MAX_FILE_BYTES) {
      entries.push({ path, bytes: null });
      continue;
    }

    const start = localHeader + 30 + u16(zip, localHeader + 26) + u16(zip, localHeader + 28);
    const data = zip.subarray(start, start + compressedSize);
    if (method === 0) {
      entries.push({ path, bytes: data });
    } else if (method === 8) {
      // The header size can lie; the inflate cap is what actually bounds memory.
      entries.push({ path, bytes: await inflateRaw(data, MAX_FILE_BYTES) });
    } else {
      throw new ImportError(`"${path}" uses an unsupported zip compression method.`);
    }
  }
  return entries;
};

const extensionOf = (path: string) => {
  const base = path.split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  return (dot > 0 ? base.slice(dot + 1) : base.replace(/^\./, "")).toLowerCase();
};

const isJunk = (path: string) =>
  path.startsWith("__MACOSX/") || path.split("/").some((part) => part === ".DS_Store" || part === ".git" || part === "Thumbs.db");

const decodeText = (bytes: Uint8Array) => {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return text.includes("\0") ? null : text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  } catch {
    return null;
  }
};

/** Turns raw entries into project files, collecting a reason for everything left out. */
export const toProjectFiles = (raw: { path: string; bytes: Uint8Array | null }[]): ImportResult => {
  const skipped: ImportResult["skipped"] = [];
  let entries = raw
    .map((entry) => ({ ...entry, path: entry.path.replace(/\\/g, "/").replace(/^\.?\/+/, "") }))
    .filter((entry) => entry.path && !isJunk(entry.path));

  // Overleaf and most zip tools wrap everything in one top folder; drop it so main.tex sits at the root.
  const tops = new Set(entries.map((entry) => entry.path.split("/")[0]));
  if (tops.size === 1 && entries.every((entry) => entry.path.includes("/"))) {
    entries = entries.map((entry) => ({ ...entry, path: entry.path.slice(entry.path.indexOf("/") + 1) }));
  }

  // Images last: when the project fills up, a template's .tex/.sty/.bst still get in and only images are skipped.
  entries.sort((a, b) => Number(extensionOf(a.path) in IMAGE_TYPES) - Number(extensionOf(b.path) in IMAGE_TYPES));

  const files: ImportedFile[] = [];
  let total = 0;
  for (const { path, bytes } of entries) {
    if (path.split("/").some((part) => part === "..")) {
      skipped.push({ name: path, reason: "path leaves the project folder" });
      continue;
    }
    if (!bytes) {
      skipped.push({ name: path, reason: `larger than ${MAX_FILE_BYTES / 1024} KB` });
      continue;
    }
    const ext = extensionOf(path);
    const text = IMAGE_TYPES[ext] ? toDataUrl(bytes, IMAGE_TYPES[ext]) : BINARY_EXTENSIONS.has(ext) ? null : decodeText(bytes);
    if (text === null) {
      skipped.push({ name: path, reason: "only .png, .jpg, .pdf and .eps images are supported" });
      continue;
    }
    // Base64 is a third bigger than the image; the backend limits the stored size.
    const size = new TextEncoder().encode(text).length;
    if (size > MAX_FILE_BYTES) {
      skipped.push({ name: path, reason: `larger than ${MAX_FILE_BYTES / 1024} KB once stored` });
      continue;
    }
    if (files.length >= MAX_FILE_COUNT || total + size > MAX_PROJECT_BYTES) {
      skipped.push({ name: path, reason: `project limit (${MAX_FILE_COUNT} files, ${MAX_PROJECT_BYTES / 1024 / 1024} MB)` });
      continue;
    }
    total += size;
    files.push({ name: path, content: text });
  }

  // Main document first: it opens in the editor and is what Recompile builds.
  const score = (file: ImportedFile) =>
    (/\\documentclass/.test(file.content) ? 0 : 2) + (/(^|\/)main\.tex$/i.test(file.name) ? 0 : 1) + (file.name.includes("/") ? 1 : 0);
  files.sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name));
  return { files, skipped };
};

/** Reads whatever the user picked: one .zip, or one or more loose files. */
export const importUploads = async (picked: File[]): Promise<ImportResult & { title: string }> => {
  const zip = picked.find((file) => file.name.toLowerCase().endsWith(".zip"));
  if (zip) {
    if (picked.length > 1) throw new ImportError("Upload one .zip at a time, without other files.");
    const result = toProjectFiles(await readZip(new Uint8Array(await zip.arrayBuffer())));
    return { ...result, title: zip.name.replace(/\.zip$/i, "") };
  }

  const raw = await Promise.all(
    picked.map(async (file) => ({
      path: file.name,
      bytes: file.size > MAX_FILE_BYTES ? null : new Uint8Array(await file.arrayBuffer()),
    })),
  );
  const result = toProjectFiles(raw);
  const title = (result.files[0]?.name ?? picked[0]?.name ?? "Uploaded project").replace(/\.[^./]+$/, "");
  return { ...result, title };
};
