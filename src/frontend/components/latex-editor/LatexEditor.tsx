"use client";

import { useEffect, useImperativeHandle, useLayoutEffect, useRef, type Ref } from "react";
import { basicSetup } from "codemirror";
import { EditorSelection, EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { indentWithTab, insertNewlineAndIndent } from "@codemirror/commands";
import { HighlightStyle, StreamLanguage, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { snippetCompletion, type Completion, type CompletionContext } from "@codemirror/autocomplete";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { tags } from "@lezer/highlight";
import { apiJson, errorMessage } from "@/lib/api";
import "./LatexEditor.css";

export type FormatCommand = "textbf" | "textit" | "underline" | "textrm";

/** The slice of the old <textarea> API that page.tsx relies on. */
export type LatexEditorHandle = {
  focus: () => void;
  setSelectionRange: (start: number, end: number) => void;
  readonly selectionStart: number;
  readonly selectionEnd: number;
};

type Props = {
  docId: string;
  value: string;
  onChange: (value: string) => void;
  onCursor: (position: number) => void;
  onFormat: (command: FormatCommand) => void;
  onGenerateError: (message: string) => void;
  onCompile: () => void;
  ref?: Ref<LatexEditorHandle>;
};

const latex = StreamLanguage.define(stex);

// ${} marks tab stops: Tab jumps between them after inserting.
const commandSnippets: [string, string, string][] = [
  ["section", "\\section{${title}}", "heading"],
  ["subsection", "\\subsection{${title}}", "heading"],
  ["subsubsection", "\\subsubsection{${title}}", "heading"],
  ["chapter", "\\chapter{${title}}", "heading"],
  ["paragraph", "\\paragraph{${title}}", "heading"],
  ["textbf", "\\textbf{${text}}", "format"],
  ["textit", "\\textit{${text}}", "format"],
  ["emph", "\\emph{${text}}", "format"],
  ["underline", "\\underline{${text}}", "format"],
  ["texttt", "\\texttt{${text}}", "format"],
  ["frac", "\\frac{${num}}{${den}}", "math"],
  ["sqrt", "\\sqrt{${x}}", "math"],
  ["sum", "\\sum_{${i}}^{${n}}", "math"],
  ["int", "\\int_{${a}}^{${b}}", "math"],
  ["mathbb", "\\mathbb{${R}}", "math"],
  ["mathrm", "\\mathrm{${text}}", "math"],
  ["label", "\\label{${key}}", "ref"],
  ["ref", "\\ref{${key}}", "ref"],
  ["eqref", "\\eqref{${key}}", "ref"],
  ["cite", "\\cite{${key}}", "ref"],
  ["input", "\\input{${file}}", "file"],
  ["include", "\\include{${file}}", "file"],
  ["includegraphics", "\\includegraphics[width=${\\linewidth}]{${file}}", "file"],
  ["usepackage", "\\usepackage{${package}}", "preamble"],
  ["documentclass", "\\documentclass{${article}}", "preamble"],
  ["usetikzlibrary", "\\usetikzlibrary{${arrows.meta,positioning}}", "tikz"],
  ["tikzset", "\\tikzset{${style}/.style={${}}}", "tikz"],
  ["draw", "\\draw[${->}] (${0,0}) -- (${1,1});", "tikz"],
  ["node", "\\node[${draw}] (${name}) at (${0,0}) {${text}};", "tikz"],
  ["fill", "\\fill[${color}] (${0,0}) circle (${2pt});", "tikz"],
  ["path", "\\path (${0,0}) -- (${1,1});", "tikz"],
  ["coordinate", "\\coordinate (${name}) at (${0,0});", "tikz"],
  ["foreach", "\\foreach \\${x} in {${1,...,5}} {\n  ${}\n}", "tikz"],
  ["item", "\\item ${}", "list"],
  ["maketitle", "\\maketitle", "document"],
  ["tableofcontents", "\\tableofcontents", "document"],
  ["newcommand", "\\newcommand{\\${name}}[${1}]{${body}}", "preamble"],
  ["hspace", "\\hspace{${1em}}", "spacing"],
  ["vspace", "\\vspace{${1em}}", "spacing"],
  ["centering", "\\centering", "layout"],
  ["caption", "\\caption{${text}}", "float"],
];

const environments = [
  "document", "tikzpicture", "figure", "table", "tabular", "center", "itemize", "enumerate",
  "description", "equation", "equation*", "align", "align*", "gather", "matrix", "pmatrix",
  "bmatrix", "cases", "minipage", "abstract", "quote", "verbatim", "scope", "axis", "frame",
];

const commandOptions: Completion[] = [
  ...commandSnippets.map(([label, template, detail]) =>
    snippetCompletion(template, { label: `\\${label}`, detail, type: "function" }),
  ),
  snippetCompletion("\\begin{${env}}\n\t${}\n\\end{${env}}", { label: "\\begin", detail: "environment", type: "keyword" }),
  ...environments.map((env) =>
    snippetCompletion(`\\begin{${env}}\n\t\${}\n\\end{${env}}`, {
      label: `\\begin{${env}}`,
      detail: "environment",
      type: "keyword",
      boost: env === "tikzpicture" ? 2 : 0,
    }),
  ),
];

const environmentOptions: Completion[] = environments.map((env) => ({ label: env, type: "keyword" }));

const promptOption = snippetCompletion("/! ${prompt} !/", { label: "/! prompt !/", detail: "generate LaTeX", type: "text" });

const latexCompletions = (context: CompletionContext) => {
  // `/!` at line start: offer the prompt wrapper, cursor lands inside it.
  const prompt = context.matchBefore(/^\s*\/!/);
  if (prompt) return { from: prompt.to - 2, options: [promptOption] };
  // Inside \begin{...} or \end{...}: environment names.
  const env = context.matchBefore(/\\(?:begin|end)\{[\w*]*/);
  if (env) {
    return { from: env.from + env.text.indexOf("{") + 1, options: environmentOptions, validFor: /^[\w*]*$/ };
  }
  const command = context.matchBefore(/\\[a-zA-Z]*/);
  if (!command || (command.from === command.to && !context.explicit)) {
    return null;
  }
  return { from: command.from, options: commandOptions, validFor: /^\\[a-zA-Z]*$/ };
};

// Enter right after a lone \begin{x} opens the block and adds the matching \end{x}, like Overleaf.
const closeEnvironmentOnEnter = (view: EditorView) => {
  const { state } = view;
  const range = state.selection.main;
  if (!range.empty) return false;
  const line = state.doc.lineAt(range.head);
  const before = line.text.slice(0, range.head - line.from);
  const match = /\\begin\{([^{}]+)\}(?:\[[^\]]*\]|\{[^{}]*\})*\s*$/.exec(before);
  if (!match || line.text.slice(range.head - line.from).trim() !== "") return false;

  const name = match[1];
  const rest = state.doc.sliceString(range.head);
  const opened = (rest.match(new RegExp(`\\\\begin\\{${name.replace(/\*/g, "\\*")}\\}`, "g")) ?? []).length;
  const closed = (rest.match(new RegExp(`\\\\end\\{${name.replace(/\*/g, "\\*")}\\}`, "g")) ?? []).length;
  if (closed > opened) return false; // Already closed further down.

  const indent = /^\s*/.exec(line.text)?.[0] ?? "";
  const unit = state.facet(indentUnit);
  const insert = `\n${indent}${unit}\n${indent}\\end{${name}}`;
  view.dispatch({
    changes: { from: range.head, insert },
    selection: EditorSelection.cursor(range.head + 1 + indent.length + unit.length),
    scrollIntoView: true,
    userEvent: "input",
  });
  return true;
};

// A whole line `/! instruction !/`; `red!50!blue` or `[h!]` inside normal code never matches.
const INSTRUCTION_LINE = /^(\s*)\/!\s*(.+?)\s*!\/\s*$/;

// Enter on an instruction line asks the backend LLM for LaTeX and swaps the line for the result.
const generateOnEnter = (view: EditorView, onError: (message: string) => void) => {
  const { state } = view;
  if (!state.selection.main.empty) return false;
  const line = state.doc.lineAt(state.selection.main.head);
  const match = INSTRUCTION_LINE.exec(line.text);
  if (!match) return false;

  const [, indent, instruction] = match;
  const placeholder = `${indent}% generating: ${instruction}`;
  const text = state.doc.toString();
  const begin = text.indexOf("\\begin{document}");
  const preamble = begin === -1 ? "" : text.slice(0, begin).slice(-8000);
  view.dispatch({ changes: { from: line.from, to: line.to, insert: placeholder }, userEvent: "input" });

  // The user may keep typing meanwhile, so find the placeholder again instead of trusting old offsets.
  // ponytail: if they switched files before the reply, the placeholder stays in that file; track per-file state if that bites.
  const swap = (insert: string) => {
    if (!view.dom.isConnected) return;
    const at = view.state.doc.toString().indexOf(placeholder);
    if (at === -1) return;
    view.dispatch({ changes: { from: at, to: at + placeholder.length, insert }, userEvent: "input" });
  };
  apiJson<{ code: string }>("/api/v1/generate", { method: "POST", body: JSON.stringify({ instruction, preamble }) })
    .then(({ code }) => swap(code.split("\n").map((codeLine) => indent + codeLine).join("\n")))
    .catch((error) => {
      swap(line.text);
      onError(errorMessage(error));
    });
  return true;
};

// Colours come from the project palette tokens, so light/dark switch with data-theme.
const highlight = HighlightStyle.define([
  { tag: tags.tagName, color: "var(--accent)", fontWeight: "600" },
  { tag: [tags.atom, tags.special(tags.variableName)], color: "var(--lilac)" },
  { tag: tags.keyword, color: "var(--warm)" },
  { tag: tags.bracket, color: "var(--muted)" },
  { tag: tags.number, color: "var(--rose)" },
  { tag: tags.string, color: "var(--sage)" },
  { tag: tags.comment, color: "var(--subtle)", fontStyle: "italic" },
  { tag: tags.invalid, color: "var(--rose)" },
]);

const theme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "var(--sunken)", color: "var(--ink)", fontSize: "0.95rem" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace', lineHeight: "1.65" },
  ".cm-content": { padding: "24px 0", caretColor: "var(--warm)" },
  ".cm-line": { padding: "0 24px 0 16px" },
  ".cm-cursor": { borderLeftColor: "var(--warm)", borderLeftWidth: "2px" },
  ".cm-gutters": { backgroundColor: "var(--sunken)", color: "var(--subtle)", border: "none", borderRight: "1px solid var(--line-soft)" },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 10px 0 14px" },
  ".cm-activeLine": { backgroundColor: "rgb(var(--accent-rgb) / 0.06)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--ink)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "rgb(var(--accent-rgb) / 0.24) !important",
  },
  ".cm-matchingBracket": { backgroundColor: "rgb(var(--warm-rgb) / 0.25)", outline: "none" },
  ".cm-tooltip": { backgroundColor: "var(--raised)", border: "1px solid var(--line)", borderRadius: "8px", overflow: "hidden" },
  ".cm-tooltip-autocomplete > ul": { fontFamily: "inherit", maxHeight: "16em" },
  ".cm-tooltip-autocomplete > ul > li": { padding: "3px 10px !important" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": { background: "var(--accent-fill)", color: "var(--accent-ink)" },
  ".cm-completionDetail": { color: "var(--muted)", fontStyle: "normal", marginLeft: "12px" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected] .cm-completionDetail": { color: "inherit", opacity: 0.8 },
  ".cm-completionMatchedText": { textDecoration: "none", fontWeight: "700" },
  ".cm-snippetField": { backgroundColor: "rgb(var(--warm-rgb) / 0.18)" },
  ".cm-panels": { backgroundColor: "var(--panel)", color: "var(--ink)" },
});

export default function LatexEditor({ docId, value, onChange, onCursor, onFormat, onGenerateError, onCompile, ref }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // One EditorState per file keeps each file's own undo history across switches.
  const statesRef = useRef(new Map<string, EditorState>());
  const docIdRef = useRef(docId);
  const syncingRef = useRef(false);
  const callbacks = useRef({ onChange, onCursor, onFormat, onGenerateError, onCompile });
  useLayoutEffect(() => {
    callbacks.current = { onChange, onCursor, onFormat, onGenerateError, onCompile };
  });

  const makeState = (doc: string) =>
    EditorState.create({
      doc,
      extensions: [
        basicSetup,
        latex,
        latex.data.of({ autocomplete: latexCompletions, closeBrackets: { brackets: ["{", "[", "(", "$"] } }),
        syntaxHighlighting(highlight),
        theme,
        indentUnit.of("  "),
        EditorState.tabSize.of(2),
        Prec.highest(
          keymap.of([
            {
              key: "Enter",
              run: (view) =>
                generateOnEnter(view, (message) => callbacks.current.onGenerateError(message)) ||
                closeEnvironmentOnEnter(view) ||
                insertNewlineAndIndent(view),
            },
            { key: "Mod-b", run: () => (callbacks.current.onFormat("textbf"), true) },
            { key: "Mod-i", run: () => (callbacks.current.onFormat("textit"), true) },
            { key: "Mod-u", run: () => (callbacks.current.onFormat("underline"), true) },
            // Compile like Overleaf: Mod-Enter, and Mod-s (which would otherwise open the browser's save dialog).
            { key: "Mod-Enter", run: () => (callbacks.current.onCompile(), true) },
            { key: "Mod-s", run: () => (callbacks.current.onCompile(), true) },
          ]),
        ),
        keymap.of([indentWithTab]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !syncingRef.current) callbacks.current.onChange(update.state.doc.toString());
          if (update.selectionSet || update.docChanged) callbacks.current.onCursor(update.state.selection.main.head);
        }),
      ],
    });

  useEffect(() => {
    const view = new EditorView({ state: makeState(value), parent: hostRef.current! });
    viewRef.current = view;
    const states = statesRef.current;
    return () => {
      view.destroy();
      viewRef.current = null;
      states.clear();
    };
    // Created once; later file switches and value changes are synced below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Layout effect so the new file is loaded before callers' requestAnimationFrame focus/select runs.
  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    if (docIdRef.current !== docId) {
      statesRef.current.set(docIdRef.current, view.state);
      docIdRef.current = docId;
      const saved = statesRef.current.get(docId);
      view.setState(saved && saved.doc.toString() === value ? saved : makeState(value));
      return;
    }

    // Outside edits (toolbar buttons, project load): apply only the changed span so cursor and undo survive.
    const current = view.state.doc.toString();
    if (current === value) return;
    let from = 0;
    while (from < current.length && from < value.length && current[from] === value[from]) from++;
    let end = 0;
    while (
      end < current.length - from &&
      end < value.length - from &&
      current[current.length - 1 - end] === value[value.length - 1 - end]
    ) end++;
    syncingRef.current = true;
    view.dispatch({ changes: { from, to: current.length - end, insert: value.slice(from, value.length - end) } });
    syncingRef.current = false;
  }, [docId, value]);

  useImperativeHandle(ref, () => ({
    focus: () => viewRef.current?.focus(),
    setSelectionRange: (start, end) => {
      const view = viewRef.current;
      if (!view) return;
      const length = view.state.doc.length;
      const anchor = Math.min(start, length);
      view.dispatch({
        selection: EditorSelection.range(anchor, Math.min(end, length)),
        effects: EditorView.scrollIntoView(anchor, { y: "start", yMargin: 48 }),
      });
      view.focus();
    },
    get selectionStart() {
      return viewRef.current?.state.selection.main.from ?? 0;
    },
    get selectionEnd() {
      return viewRef.current?.state.selection.main.to ?? 0;
    },
  }), []);

  return <div className="code-editor" ref={hostRef} />;
}
