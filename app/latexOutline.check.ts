// Run: node app/latexOutline.check.ts
import assert from "node:assert/strict";
import { buildOutline } from "./latexOutline.ts";

const main = String.raw`\documentclass{article}
\begin{document}\section{Intro}
% \section{Commented out}
Price is 5\% \subsection*{The $\mathbb{R}$ case}
\section[Short]{A \textbf{\emph{nested}} title}
\input{chapters/methods}
\\section{not a heading, a line break}
\include{loop}
\sectionmark{ignored}
\end{document}`;

const files = [
  { id: "m", name: "main.tex", content: main },
  { id: "c", name: "methods.tex", content: String.raw`\section {Methods}
\subsection{Setup}` },
  { id: "l", name: "loop.tex", content: String.raw`\subsection{Loop}\input{main}` },
];

const outline = buildOutline("m", files);

assert.deepEqual(
  outline.map((item) => [item.fileId, item.title, item.depth]),
  [
    ["m", "Intro", 0],
    ["m", "The $\\mathbb{R}$ case", 1],
    ["m", "A \\textbf{\\emph{nested}} title", 0],
    ["c", "Methods", 0],
    ["c", "Setup", 1],
    ["l", "Loop", 1],
  ],
);

const setup = outline[4];
assert.equal(setup.line, 2);
assert.equal(setup.parentId, outline[3].id);
assert.equal(setup.anchor, main.indexOf("\\input"), "included headings anchor at their \\input");
assert.ok(outline[0].hasChildren && !outline[1].hasChildren);

console.log("latexOutline ok");
