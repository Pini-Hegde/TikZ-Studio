import { apiFetch } from "@/lib/api";
import { sanitizeFileName, type ProjectFile } from "@/lib/projects";

// The LaTeX engines the backend can run, from GET /api/v1/compile/engines.
export type EngineOptions = { engines: string[]; default: string };

export type CompileOutput =
  | {
      ok: true;
      pdfFileName: string;
      pdfObjectUrl: string;
      // Errors LaTeX hit while still making the PDF (Overleaf-style); "" for a clean compile.
      errors: string;
    }
  | {
      ok: false;
      message: string;
      log: string;
    };

type CompileErrorResponse = {
  success: false;
  error: {
    code: string;
    message: string;
    log?: string;
    details?: Array<{ path: string; message: string }>;
  };
  requestId: string;
};

const pdfFileNameFromResponse = (contentDisposition: string | null, fallback: string) => {
  const encodedName = contentDisposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];

  if (encodedName) {
    try {
      return decodeURIComponent(encodedName);
    } catch {
      return fallback;
    }
  }

  return contentDisposition?.match(/filename="([^"]+)"/i)?.[1] ?? fallback;
};

// Sends the project to the backend: resolves to the PDF or the compile error; throws if the backend can't be reached.
export const compileProject = async (
  mainFile: ProjectFile,
  files: ProjectFile[],
  // The project's engine; undefined lets the backend use its default.
  engine: string | undefined,
  signal: AbortSignal,
): Promise<CompileOutput> => {
  const response = await apiFetch("/api/v1/compile", {
    method: "POST",
    body: JSON.stringify({
      mainFileName: mainFile.name,
      engine,
      files: files.map((file) => ({ name: file.name, content: file.content })),
    }),
    signal,
  });
  if (!response.ok) {
    const result = (await response.json()) as CompileErrorResponse;

    return {
      ok: false,
      message: result.error.message,
      log:
        result.error.log ??
        result.error.details?.map((detail) => `${detail.path}: ${detail.message}`).join("\n") ??
        "",
    };
  }

  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.toLowerCase().startsWith("application/pdf")) {
    throw new Error("The backend did not return a PDF document.");
  }

  const pdfBlob = await response.blob();
  const fallbackFileName = `${sanitizeFileName(mainFile.name.replace(/\.tex$/i, ""))}.pdf`;

  return {
    ok: true,
    pdfFileName: pdfFileNameFromResponse(response.headers.get("content-disposition"), fallbackFileName),
    pdfObjectUrl: URL.createObjectURL(pdfBlob),
    errors: decodeURIComponent(response.headers.get("x-compile-errors") ?? ""),
  };
};

// A file the project needs but TeX Live doesn't have (a template's .sty, .cls or .bst) has to be uploaded.
const withHint = (message: string) =>
  /File `.+' not found/.test(message) ? `${message} If it came with your template, upload it to the project.` : message;

// The first error in a TeX log, so the preview can point at the line: "./Main.tex:12: message" (the backend runs
// pdflatex with -file-line-error) or "! message" followed by "l.12 ...". TeX hard-wraps its log at 79 characters.
// Also bibtex's "I couldn't open style file x.bst" and biber's "ERROR - ...", which have no line.
export const firstTexError = (log: string) => {
  const lines = log.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const bibtex = /I couldn't open (style|database) file (\S+)/.exec(lines[i]);
    if (bibtex) {
      return {
        file: null,
        line: null,
        message: `BibTeX couldn't open the ${bibtex[1]} file ${bibtex[2]}. Upload it to the project, or check its name.`,
      };
    }
    const biber = /^ERROR - (.+)/.exec(lines[i]);
    if (biber) return { file: null, line: null, message: `Biber: ${biber[1]}` };
    const fileLine = /^(?:\.\/)?(.+?\.tex):(\d+): (.*)$/.exec(lines[i]);
    if (fileLine) {
      let message = fileLine[3];
      for (let j = i; lines[j].length === 79 && j + 1 < lines.length; j++) message += lines[j + 1];
      // The backend compiles in a temporary ".../project/" folder; keep only the path inside the project.
      const file = fileLine[1].replace(/^.*\/project\//, "");
      return { file, line: Number(fileLine[2]), message: withHint(message.trim()) };
    }
    if (lines[i].startsWith("! ")) {
      const at = lines.slice(i + 1, i + 12).find((line) => /^l\.\d+/.test(line));
      return { file: null, line: at ? Number(/^l\.(\d+)/.exec(at)?.[1]) : null, message: withHint(lines[i].slice(2).trim()) };
    }
  }
  return null;
};
