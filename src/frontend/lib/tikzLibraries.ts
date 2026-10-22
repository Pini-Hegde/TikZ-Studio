// The TikZ libraries Figure Studio's figures may use. The model is told they are available, previews load them, and
// Insert adds whichever the document lacks, so an approved figure compiles in the project just as it did in the preview.
export const FIGURE_LIBRARIES = [
  "arrows.meta",
  "arrows", // deprecated, but models still write its latex' and stealth' tips
  "positioning",
  "calc",
  "shapes.geometric",
  "shapes.misc",
  "fit",
  "backgrounds",
  "matrix",
  "chains",
  "decorations.pathreplacing",
  "decorations.pathmorphing",
  "patterns",
  "shadows",
  "intersections",
  "angles",
  "quotes",
  "3d",
];

/** The lines `preamble` needs for Figure Studio's figures: \usepackage{tikz} and the missing libraries, or "". */
export const figureLines = (preamble: string) => {
  const code = preamble.replace(/(^|[^\\])%.*$/gm, "$1"); // commented-out lines don't count
  const hasTikz = /\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\])?\s*\{[^}]*\btikz\b[^}]*\}/.test(code);
  const loaded = new Set(
    [...code.matchAll(/\\usetikzlibrary\s*\{([^}]*)\}/g)].flatMap((match) => match[1].split(",").map((name) => name.trim())),
  );
  const missing = FIGURE_LIBRARIES.filter((name) => !loaded.has(name));
  const lines = [...(hasTikz ? [] : ["\\usepackage{tikz}"]), ...(missing.length ? [`\\usetikzlibrary{${missing.join(",")}}`] : [])];
  return lines.length ? `% Added by Figure Studio\n${lines.join("\n")}\n\n` : "";
};

/** `source` with figureLines added just before \begin{document}; unchanged without one. */
export const withFigureLibraries = (source: string) => {
  const begin = source.indexOf("\\begin{document}");
  return begin === -1 ? source : source.slice(0, begin) + figureLines(source.slice(0, begin)) + source.slice(begin);
};
