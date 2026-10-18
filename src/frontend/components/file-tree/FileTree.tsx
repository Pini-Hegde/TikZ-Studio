"use client";

import { useEffect, useState, type CSSProperties, type DragEvent, type KeyboardEvent } from "react";
import {
  BookMarked,
  ChevronRight,
  File,
  FileCode2,
  FileImage,
  FilePlus,
  FileSpreadsheet,
  FileTerminal,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  LayoutTemplate,
  ListOrdered,
  MoreVertical,
  Palette,
  Pencil,
  Shapes,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { MAX_FILE_COUNT } from "@/lib/projectImport";
import "./FileTree.css";

// A VS Code-style file tree. Folders are not stored: a file named "chapters/intro.tex" lives in "chapters".
// An empty folder keeps a hidden "<folder>/.keep" file (the usual convention) until something else is in it,
// so projects stay a flat list of files and nothing changes for saving, compiling or downloading.

export type TreeFile = { id: string; name: string; content: string };

type Props = {
  files: TreeFile[];
  activeFileId: string;
  mainFileId?: string;
  onSelect: (fileId: string) => void;
  onChange: (files: TreeFile[], nextActiveId?: string) => void;
  onUpload: () => void;
  onFigure: () => void;
  onError: (message: string) => void;
};

type FolderNode = { kind: "folder"; path: string; name: string; children: TreeNode[] };
type FileNode = { kind: "file"; file: TreeFile; name: string };
type TreeNode = FolderNode | FileNode;
type Draft = { mode: "new-file" | "new-folder" | "rename-file" | "rename-folder"; parent: string; target: string; value: string; error: string };
type DragSource = { kind: "file"; id: string } | { kind: "folder"; path: string };

const KEEP = ".keep";
const isKeep = (name: string) => name === KEEP || name.endsWith(`/${KEEP}`);
const dirOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
const baseOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);
const inside = (path: string, folder: string) => path.startsWith(`${folder}/`);
const extOf = (name: string) => (name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "");

// The files a LaTeX project usually holds, each with its own icon and colour.
const FILE_TYPES: { exts: string[]; Icon: typeof File; tone: string; label: string }[] = [
  { exts: ["tex", "ltx"], Icon: FileCode2, tone: "tex", label: "LaTeX document" },
  { exts: ["bib"], Icon: BookMarked, tone: "bib", label: "Bibliography" },
  { exts: ["bst", "bbx", "cbx"], Icon: ListOrdered, tone: "bib", label: "Bibliography style" },
  { exts: ["sty"], Icon: Palette, tone: "sty", label: "Package" },
  { exts: ["cls"], Icon: LayoutTemplate, tone: "sty", label: "Document class" },
  { exts: ["tikz", "pgf"], Icon: Shapes, tone: "tikz", label: "TikZ picture" },
  { exts: ["csv", "dat", "tsv", "table"], Icon: FileSpreadsheet, tone: "data", label: "Data table" },
  { exts: ["png", "jpg", "jpeg", "gif", "svg", "eps", "pdf"], Icon: FileImage, tone: "image", label: "Image" },
  { exts: ["txt", "md"], Icon: FileText, tone: "text", label: "Text" },
  { exts: ["log", "aux", "bbl", "toc", "out", "blg"], Icon: FileTerminal, tone: "text", label: "Build output" },
];
export const fileTypeOf = (name: string) =>
  FILE_TYPES.find((type) => type.exts.includes(extOf(name))) ?? { Icon: File, tone: "text", label: "File" };

// Starter content for files that need some boilerplate to be useful.
const STARTERS: Record<string, (stem: string) => string> = {
  tikz: () => "\\begin{tikzpicture}\n  \n\\end{tikzpicture}\n",
  sty: (stem) => `\\NeedsTeXFormat{LaTeX2e}\n\\ProvidesPackage{${stem}}\n\n`,
  cls: (stem) => `\\NeedsTeXFormat{LaTeX2e}\n\\ProvidesClass{${stem}}\n\\LoadClass{article}\n`,
};

const byName = (a: TreeNode, b: TreeNode) =>
  a.kind !== b.kind ? (a.kind === "folder" ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });

function buildTree(files: TreeFile[]): TreeNode[] {
  const root: FolderNode = { kind: "folder", path: "", name: "", children: [] };
  const folders = new Map<string, FolderNode>([["", root]]);
  const folderAt = (path: string): FolderNode => {
    const known = folders.get(path);
    if (known) return known;
    const node: FolderNode = { kind: "folder", path, name: baseOf(path), children: [] };
    folderAt(dirOf(path)).children.push(node);
    folders.set(path, node);
    return node;
  };
  for (const file of files) {
    const folder = folderAt(dirOf(file.name));
    if (!isKeep(file.name)) folder.children.push({ kind: "file", file, name: baseOf(file.name) });
  }
  const sort = (node: FolderNode) => {
    node.children.sort(byName);
    node.children.forEach((child) => child.kind === "folder" && sort(child));
  };
  sort(root);
  return root.children;
}

// Drop placeholders that are no longer needed: a folder with anything else in it exists on its own.
const tidy = (files: TreeFile[]) =>
  files.filter((file) => !isKeep(file.name) || !files.some((other) => other !== file && inside(other.name, dirOf(file.name))));

const keepFor = (folder: string): TreeFile => ({ id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name: join(folder, KEEP), content: "" });

export default function FileTree({ files, activeFileId, mainFileId, onSelect, onChange, onUpload, onFigure, onError }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [focusFolder, setFocusFolder] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragSource | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const activeFile = files.find((file) => file.id === activeFileId);
  const tree = buildTree(files);
  // New items go into the folder last clicked, else the open file's folder.
  const targetFolder = focusFolder ?? (activeFile ? dirOf(activeFile.name) : "");

  // Menus close on a click elsewhere or on Escape.
  useEffect(() => {
    if (!menu) return;
    const onDown = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest(".file-options-menu, .file-menu-trigger")) return;
      setMenu(null);
    };
    const onKey = (event: globalThis.KeyboardEvent) => event.key === "Escape" && setMenu(null);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const taken = (path: string, except?: string) =>
    files.some((file) => {
      if (except && (file.name === except || inside(file.name, except))) return false;
      const name = file.name.toLowerCase();
      return name === path.toLowerCase() || name.startsWith(`${path.toLowerCase()}/`);
    });

  const nameProblem = (name: string) => {
    if (!name) return "Enter a name.";
    if (/[/\\]/.test(name)) return "Names can't contain slashes.";
    if (name === "." || name === ".." || name === KEEP) return "That name is reserved.";
    return "";
  };

  const expand = (path: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      for (let dir = path; dir; dir = dirOf(dir)) next.delete(dir);
      return next;
    });

  const startDraft = (mode: Draft["mode"], parent: string, target = "", value = "") => {
    setMenu(null);
    if (parent) expand(parent);
    setDraft({ mode, parent, target, value, error: "" });
  };

  const commitDraft = () => {
    if (!draft) return;
    let value = draft.value.trim();
    if (draft.mode === "new-file" && value && !value.includes(".")) value += ".tex"; // LaTeX projects are mostly .tex
    const problem = nameProblem(value);
    if (problem) return setDraft({ ...draft, error: problem });

    if (draft.mode === "new-file" || draft.mode === "new-folder") {
      const path = join(draft.parent, value);
      if (taken(path)) return setDraft({ ...draft, error: `"${value}" already exists here.` });
      if (tidy([...files, keepFor(path)]).length > MAX_FILE_COUNT) {
        onError(`A project can hold up to ${MAX_FILE_COUNT} files.`);
        return setDraft(null);
      }
      setDraft(null);
      if (draft.mode === "new-folder") {
        onChange(tidy([...files, keepFor(path)]));
        expand(path);
        setFocusFolder(path);
        return;
      }
      const stem = value.replace(/\.[^.]+$/, "");
      const file: TreeFile = { id: `file-${Date.now()}`, name: path, content: STARTERS[extOf(value)]?.(stem) ?? "" };
      onChange(tidy([...files, file]), file.id);
      setFocusFolder(null);
      return;
    }

    const newPath = join(dirOf(draft.target), value);
    if (newPath === draft.target) return setDraft(null);
    if (taken(newPath, draft.target)) return setDraft({ ...draft, error: `"${value}" already exists here.` });
    setDraft(null);
    if (draft.mode === "rename-file") {
      onChange(files.map((file) => (file.name === draft.target ? { ...file, name: newPath } : file)));
    } else {
      onChange(files.map((file) => (inside(file.name, draft.target) ? { ...file, name: newPath + file.name.slice(draft.target.length) } : file)));
      setCollapsed((current) => new Set([...current].map((path) => (path === draft.target || inside(path, draft.target) ? newPath + path.slice(draft.target.length) : path))));
    }
  };

  const draftKeys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitDraft();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setDraft(null);
    }
  };

  // Whatever is left when the open file goes away: the first remaining file that isn't a placeholder.
  const fallbackActive = (remaining: TreeFile[]) =>
    remaining.some((file) => file.id === activeFileId) ? undefined : (remaining.find((file) => !isKeep(file.name))?.id ?? "");

  const deleteFile = (file: TreeFile) => {
    setMenu(null);
    let remaining = files.filter((candidate) => candidate.id !== file.id);
    const dir = dirOf(file.name);
    if (dir && !remaining.some((candidate) => inside(candidate.name, dir))) remaining = [...remaining, keepFor(dir)]; // keep the folder
    onChange(tidy(remaining), fallbackActive(remaining));
  };

  const deleteFolder = (path: string) => {
    setMenu(null);
    const count = files.filter((file) => inside(file.name, path) && !isKeep(file.name)).length;
    if (count && !window.confirm(`Delete the folder "${baseOf(path)}" and the ${count} file${count === 1 ? "" : "s"} in it?`)) return;
    let remaining = files.filter((file) => !inside(file.name, path));
    const parent = dirOf(path);
    if (parent && !remaining.some((file) => inside(file.name, parent))) remaining = [...remaining, keepFor(parent)];
    onChange(tidy(remaining), fallbackActive(remaining));
    if (focusFolder && (focusFolder === path || inside(focusFolder, path))) setFocusFolder(null);
  };

  // Move a dragged file or folder into a folder ("" is the project root).
  const move = (source: DragSource, folder: string) => {
    const from = source.kind === "file" ? files.find((file) => file.id === source.id)?.name : source.path;
    if (from === undefined) return;
    if (source.kind === "folder" && (folder === from || inside(folder, from))) return onError("A folder can't be moved into itself.");
    if (dirOf(from) === folder) return;
    const to = join(folder, baseOf(from));
    if (taken(to)) return onError(`"${baseOf(from)}" already exists in ${folder ? `"${baseOf(folder)}"` : "the project root"}.`);
    let next = files.map((file) =>
      source.kind === "file"
        ? file.id === source.id ? { ...file, name: to } : file
        : inside(file.name, from) ? { ...file, name: to + file.name.slice(from.length) } : file,
    );
    const oldParent = dirOf(from);
    if (oldParent && !next.some((file) => inside(file.name, oldParent))) next = [...next, keepFor(oldParent)];
    onChange(tidy(next));
    if (folder) expand(folder);
  };

  const dragProps = (source: DragSource) => ({
    draggable: !draft,
    onDragStart: (event: DragEvent) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", source.kind === "file" ? source.id : source.path);
      setDrag(source);
    },
    onDragEnd: () => {
      setDrag(null);
      setDropTarget(null);
    },
  });

  const dropProps = (folder: string) => ({
    onDragOver: (event: DragEvent) => {
      if (!drag) return;
      event.preventDefault();
      event.stopPropagation();
      setDropTarget(folder);
    },
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (drag) move(drag, folder);
      setDrag(null);
      setDropTarget(null);
    },
  });

  const indent = (depth: number) => ({ "--depth": depth } as CSSProperties);

  const draftRow = (depth: number, kind: "file" | "folder") =>
    draft && (
      <div className="ft-draft" style={indent(depth)}>
        <span className="ft-icon" data-tone={kind === "folder" ? "folder" : fileTypeOf(draft.value).tone}>
          {kind === "folder" ? <Folder size={16} /> : (() => { const { Icon } = fileTypeOf(draft.value || "x.tex"); return <Icon size={16} />; })()}
        </span>
        <input
          className="file-rename-input"
          autoFocus
          value={draft.value}
          placeholder={kind === "folder" ? "folder name" : "name.tex"}
          aria-label={kind === "folder" ? "Folder name" : "File name"}
          aria-invalid={Boolean(draft.error)}
          onChange={(event) => setDraft({ ...draft, value: event.target.value, error: "" })}
          onKeyDown={draftKeys}
          onBlur={() => (draft.value.trim() ? commitDraft() : setDraft(null))}
          onFocus={(event) => {
            // Renaming a file selects the name without its extension, like VS Code.
            const dot = event.target.value.lastIndexOf(".");
            event.target.setSelectionRange(0, draft.mode === "rename-file" && dot > 0 ? dot : event.target.value.length);
          }}
        />
        {draft.error && <span className="ft-error" role="alert">{draft.error}</span>}
      </div>
    );

  const renderNodes = (nodes: TreeNode[], depth: number, parent: string) => (
    <>
      {draft && (draft.mode === "new-file" || draft.mode === "new-folder") && draft.parent === parent &&
        draftRow(depth, draft.mode === "new-folder" ? "folder" : "file")}
      {nodes.map((node) => {
        if (node.kind === "folder") {
          const isOpen = !collapsed.has(node.path);
          const key = `folder:${node.path}`;
          if (draft?.mode === "rename-folder" && draft.target === node.path) return <div key={key}>{draftRow(depth, "folder")}</div>;
          return (
            <div key={key} className="ft-folder">
              <div
                className={`file-row ft-row folder${dropTarget === node.path ? " drop" : ""}${focusFolder === node.path ? " focused" : ""}`}
                style={indent(depth)}
                {...dragProps({ kind: "folder", path: node.path })}
                {...dropProps(node.path)}
              >
                <button
                  className="file-link"
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => {
                    setFocusFolder(node.path);
                    setCollapsed((current) => {
                      const next = new Set(current);
                      if (isOpen) next.add(node.path);
                      else next.delete(node.path);
                      return next;
                    });
                  }}
                >
                  <ChevronRight className={isOpen ? "ft-chevron open" : "ft-chevron"} size={14} aria-hidden="true" />
                  <span className="ft-icon" data-tone="folder">{isOpen ? <FolderOpen size={16} /> : <Folder size={16} />}</span>
                  <span className="ft-name">{node.name}</span>
                </button>
                <button
                  className="file-menu-trigger"
                  type="button"
                  aria-label={`Options for folder ${node.name}`}
                  aria-haspopup="menu"
                  aria-expanded={menu === key}
                  onClick={() => setMenu((current) => (current === key ? null : key))}
                >
                  <MoreVertical size={16} />
                </button>
                {menu === key && (
                  <div className="file-options-menu" role="menu" aria-label={`${node.name} options`}>
                    <button className="file-options-item" type="button" role="menuitem" onClick={() => startDraft("new-file", node.path)}>
                      <FilePlus size={15} />
                      <span>New file</span>
                    </button>
                    <button className="file-options-item" type="button" role="menuitem" onClick={() => startDraft("new-folder", node.path)}>
                      <FolderPlus size={15} />
                      <span>New folder</span>
                    </button>
                    <button className="file-options-item" type="button" role="menuitem" onClick={() => startDraft("rename-folder", dirOf(node.path), node.path, node.name)}>
                      <Pencil size={15} />
                      <span>Rename</span>
                    </button>
                    <button className="file-options-item danger" type="button" role="menuitem" onClick={() => deleteFolder(node.path)}>
                      <Trash2 size={15} />
                      <span>Delete</span>
                    </button>
                  </div>
                )}
              </div>
              {isOpen && (
                <div className="ft-group" style={indent(depth)} {...dropProps(node.path)}>
                  {renderNodes(node.children, depth + 1, node.path)}
                </div>
              )}
            </div>
          );
        }

        const { file } = node;
        const type = fileTypeOf(file.name);
        const key = `file:${file.id}`;
        if (draft?.mode === "rename-file" && draft.target === file.name) return <div key={key}>{draftRow(depth, "file")}</div>;
        const isActive = file.id === activeFileId;
        return (
          <div
            key={key}
            className={`file-row ft-row${isActive ? " active" : ""}`}
            style={indent(depth)}
            title={`${type.label}: ${file.name}`}
            {...dragProps({ kind: "file", id: file.id })}
            {...dropProps(parent)}
          >
            <button
              className={isActive ? "file-link active" : "file-link"}
              type="button"
              onClick={() => {
                setFocusFolder(null);
                onSelect(file.id);
              }}
            >
              <span className="ft-chevron-space" aria-hidden="true" />
              <span className="ft-icon" data-tone={type.tone}>
                <type.Icon size={16} />
              </span>
              <span className="ft-name">{node.name}</span>
              {file.id === mainFileId && (
                <span className="ft-main" title="Main document: this is what Recompile builds">
                  main
                </span>
              )}
            </button>
            <button
              className="file-menu-trigger"
              type="button"
              aria-label={`Options for ${node.name}`}
              aria-haspopup="menu"
              aria-expanded={menu === key}
              onClick={() => setMenu((current) => (current === key ? null : key))}
            >
              <MoreVertical size={16} />
            </button>
            {menu === key && (
              <div className="file-options-menu" role="menu" aria-label={`${node.name} options`}>
                <button className="file-options-item" type="button" role="menuitem" onClick={() => startDraft("rename-file", dirOf(file.name), file.name, node.name)}>
                  <Pencil size={15} />
                  <span>Rename</span>
                </button>
                <button className="file-options-item danger" type="button" role="menuitem" onClick={() => deleteFile(file)}>
                  <Trash2 size={15} />
                  <span>Delete</span>
                </button>
              </div>
            )}
          </div>
        );
      })}
    </>
  );

  return (
    <nav
      className={`file-card ft${dropTarget === "" ? " drop-root" : ""}`}
      aria-label="Files"
      {...dropProps("")}
    >
      <div className="panel-header">
        <span className="panel-title">Files</span>
        <button className="panel-action" type="button" aria-label="New file" title="New file" onClick={() => startDraft("new-file", targetFolder)}>
          <FilePlus size={15} strokeWidth={2.3} />
        </button>
        <button className="panel-action" type="button" aria-label="New folder" title="New folder" onClick={() => startDraft("new-folder", targetFolder)}>
          <FolderPlus size={15} strokeWidth={2.3} />
        </button>
        <button className="panel-action" type="button" aria-label="Upload files" title="Upload files or a .zip" onClick={onUpload}>
          <Upload size={15} strokeWidth={2.4} />
        </button>
        <button className="panel-action" type="button" aria-label="Generate TikZ figure" title="Generate TikZ figure" onClick={onFigure}>
          <Sparkles size={15} strokeWidth={2.4} />
        </button>
      </div>
      <div className="ft-root" onClick={(event) => event.target === event.currentTarget && setFocusFolder(null)}>
        {renderNodes(tree, 0, "")}
      </div>
    </nav>
  );
}
