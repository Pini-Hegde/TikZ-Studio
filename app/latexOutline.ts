// File outline: \part ... \subparagraph headings, with \input / \include / \subfile expanded inline like one document.

export type OutlineFile = { id: string; name: string; content: string };

export type OutlineItem = {
  id: string;
  fileId: string;
  title: string;
  command: string;
  level: number;
  depth: number;
  parentId: string | null;
  hasChildren: boolean;
  line: number;
  /** Offset of the heading inside its own file. */
  start: number;
  /** Offset in the root file: the heading itself, or the \input that pulled it in. Drives the cursor highlight. */
  anchor: number;
};

const LEVELS: Record<string, number> = {
  part: 0,
  chapter: 1,
  section: 2,
  subsection: 3,
  subsubsection: 4,
  paragraph: 5,
  subparagraph: 6,
};

const COMMAND = /\\(part|chapter|subsubsection|subsection|section|subparagraph|paragraph|input|include|subfile)(?![a-zA-Z@])(\*?)/g;

// Index just past the group that opens at src[i], or -1. Skips \{ and \} escapes.
const skipGroup = (src: string, i: number, open: string, close: string) => {
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    const ch = src[j];
    if (ch === "\\") {
      j++;
    } else if (ch === open) {
      depth++;
    } else if (ch === close && --depth === 0) {
      return j + 1;
    }
  }
  return -1;
};

const isCommentedOut = (src: string, at: number) => {
  const lineStart = src.lastIndexOf("\n", at - 1) + 1;
  for (let j = lineStart; j < at; j++) {
    if (src[j] === "\\") {
      j++;
    } else if (src[j] === "%") {
      return true;
    }
  }
  return false;
};

const skipSpace = (src: string, i: number) => {
  while (/\s/.test(src[i] ?? "")) i++;
  return i;
};

type Found = { kind: "heading" | "include"; command: string; arg: string; start: number };

export const scanLatex = (src: string): Found[] => {
  const found: Found[] = [];
  for (const match of src.matchAll(COMMAND)) {
    const start = match.index;
    // Odd run of backslashes before it means this one is escaped (e.g. \\section is a line break + text).
    let slashes = 0;
    while (src[start - 1 - slashes] === "\\") slashes++;
    if (slashes % 2 === 1 || isCommentedOut(src, start)) continue;

    let i = skipSpace(src, start + match[0].length);
    if (src[i] === "[") {
      const end = skipGroup(src, i, "[", "]");
      if (end === -1) continue;
      i = skipSpace(src, end);
    }
    if (src[i] !== "{") continue;
    const end = skipGroup(src, i, "{", "}");
    if (end === -1) continue;

    const command = match[1];
    found.push({
      kind: command in LEVELS ? "heading" : "include",
      command,
      arg: src.slice(i + 1, end - 1).replace(/\s+/g, " ").trim(),
      start,
    });
  }
  return found;
};

// \input{chapters/intro} -> the project file "chapters/intro.tex" (or "intro.tex" when names are flat).
const resolveFile = (files: OutlineFile[], target: string) => {
  const wanted = [target, `${target}.tex`].map((name) => name.replace(/^\.\//, ""));
  const baseOf = (name: string) => name.split("/").pop();
  return (
    files.find((file) => wanted.includes(file.name)) ??
    files.find((file) => wanted.some((name) => baseOf(name) === baseOf(file.name)))
  );
};

export const buildOutline = (rootId: string, files: OutlineFile[]): OutlineItem[] => {
  const items: OutlineItem[] = [];
  const stack: OutlineItem[] = [];
  const seen: Record<string, number> = {};

  const walk = (file: OutlineFile, anchor: number | null, visiting: Set<string>) => {
    for (const entry of scanLatex(file.content)) {
      if (entry.kind === "include") {
        const child = resolveFile(files, entry.arg);
        // Guard against \input cycles (a.tex inputs b.tex inputs a.tex).
        if (child && !visiting.has(child.id)) {
          walk(child, anchor ?? entry.start, new Set(visiting).add(child.id));
        }
        continue;
      }

      const level = LEVELS[entry.command];
      while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop();
      const parent = stack[stack.length - 1] ?? null;
      if (parent) parent.hasChildren = true;

      // Title-based id keeps fold state stable while text above the heading is edited.
      const key = `${file.id}:${entry.command}:${entry.arg}`;
      seen[key] = (seen[key] ?? 0) + 1;

      const item: OutlineItem = {
        id: `${key}:${seen[key]}`,
        fileId: file.id,
        title: entry.arg || "Untitled",
        command: entry.command,
        level,
        depth: stack.length,
        parentId: parent?.id ?? null,
        hasChildren: false,
        line: file.content.slice(0, entry.start).split("\n").length,
        start: entry.start,
        anchor: anchor ?? entry.start,
      };
      items.push(item);
      stack.push(item);
    }
  };

  const root = files.find((file) => file.id === rootId);
  if (root) walk(root, null, new Set([root.id]));
  return items;
};
