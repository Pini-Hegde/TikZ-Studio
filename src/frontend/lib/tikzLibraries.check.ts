// Run: node lib/tikzLibraries.check.ts
import assert from "node:assert/strict";
import { FIGURE_LIBRARIES, figureLines, withFigureLibraries } from "./tikzLibraries.ts";

const all = `\\usetikzlibrary{${FIGURE_LIBRARIES.join(",")}}`;

// A preamble without TikZ (e.g. a CVPR paper) gets the package and every library.
const paper = "\\documentclass{article}\n\\usepackage{cvpr}\n% \\usepackage{tikz}\n\n\\begin{document}\nHi\n\\end{document}\n";
const added = withFigureLibraries(paper);
assert.ok(added.includes(`\\usepackage{tikz}\n${all}\n\n\\begin{document}`), "tikz and libraries before \\begin{document}");
assert.equal(withFigureLibraries(added), added, "adding twice changes nothing");

// Only what's missing is added; tikz loaded via a package list counts.
const partial = "\\usepackage{amsmath,tikz}\n\\usetikzlibrary{positioning, calc}\n";
const lines = figureLines(partial);
assert.ok(!lines.includes("\\usepackage{tikz}") && !/[{,]positioning[,}]/.test(lines) && !/[{,]calc[,}]/.test(lines));
assert.ok(lines.includes("arrows.meta"), "missing libraries listed");
assert.equal(figureLines(`\\usepackage{tikz}\n${all}`), "", "nothing to add");
assert.equal(withFigureLibraries("\\section{Chapter}"), "\\section{Chapter}", "no \\begin{document}: unchanged");

console.log("tikzLibraries ok");
