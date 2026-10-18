import { useEffect, useState } from "react";
import { ArrowRight, ChevronDown, Cpu, Download, RefreshCw, TriangleAlert } from "lucide-react";
import Logo from "@/components/logo/Logo";
import { apiJson } from "@/lib/api";
import { firstTexError, type CompileOutput, type EngineOptions } from "@/lib/compile";
import "./PreviewPane.css";

type Props = {
  output: CompileOutput | null;
  isCompiling: boolean;
  // The last PDF stays on screen while the source changes; this marks it as behind the editor.
  isStale: boolean;
  compileSeconds: number | null;
  fileNames: string[];
  // The project's engine; undefined until it is set (the backend's default applies).
  engine: string | undefined;
  modKey: string;
  onEngineChange: (engine: string) => void;
  onRecompile: () => void;
  onGoToLine: (fileName: string | null, line: number) => void;
};

export default function PreviewPane({
  output,
  isCompiling,
  isStale,
  compileSeconds,
  fileNames,
  engine,
  modKey,
  onEngineChange,
  onRecompile,
  onGoToLine,
}: Props) {
  const [engineOptions, setEngineOptions] = useState<EngineOptions | null>(null);

  // The engines come from the backend; the picker stays hidden if they can't be loaded.
  useEffect(() => {
    apiJson<EngineOptions>("/api/v1/compile/engines")
      .then(setEngineOptions)
      .catch(() => setEngineOptions(null));
  }, []);

  const texError = output && !output.ok ? firstTexError(output.log) : null;
  // Only offer the jump when the error is in one of the project's own files (not a system .tex file).
  const canJumpToError = Boolean(texError?.line) && (!texError?.file || fileNames.includes(texError.file));
  const compileChip = isCompiling
    ? { tone: "busy", label: "Compiling…" }
    : output?.ok
      ? isStale
        ? { tone: "stale", label: "Out of date" }
        : { tone: "ok", label: compileSeconds ? `Compiled in ${compileSeconds.toFixed(1)}s` : "Compiled" }
      : output
        ? { tone: "error", label: "Compile failed" }
        : null;

  const downloadPdf = () => {
    if (!output?.ok) {
      return;
    }

    const link = document.createElement("a");

    link.href = output.pdfObjectUrl;
    link.download = output.pdfFileName;
    link.click();
  };

  return (
    <section className="preview-pane" aria-label="LaTeX preview">
      <div className="preview-toolbar">
        <button
          className="preview-refresh-button"
          type="button"
          title={`Recompile (${modKey}↵ or ${modKey}S)`}
          onClick={onRecompile}
          disabled={isCompiling}
          aria-busy={isCompiling}
        >
          <RefreshCw
            className={isCompiling ? "preview-refresh-icon spinning" : "preview-refresh-icon"}
            size={17}
          />
          {isCompiling ? "Compiling" : "Recompile"}
        </button>
        <button
          className="download-button"
          type="button"
          aria-label="Download compiled PDF"
          disabled={!output?.ok}
          onClick={downloadPdf}
        >
          <Download size={23} />
        </button>
        {engineOptions && (
          <label className="engine-field underline-field" title="LaTeX engine for this project">
            <Cpu size={16} aria-hidden />
            <select
              aria-label="LaTeX engine"
              value={engine ?? engineOptions.default}
              onChange={(event) => onEngineChange(event.target.value)}
            >
              {engineOptions.engines.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <ChevronDown size={14} aria-hidden />
          </label>
        )}
        {compileChip && (
          <span className={`compile-chip ${compileChip.tone}`} role="status" aria-live="polite">
            <span className="compile-chip-dot" aria-hidden="true" />
            {compileChip.label}
            {compileChip.tone === "stale" && (
              <span className="compile-chip-keys" aria-hidden="true">
                <kbd>{modKey}</kbd>
                <kbd>↵</kbd>
              </span>
            )}
          </span>
        )}
      </div>

      <div className="diagram-canvas" aria-label="TikZ diagram preview">
        {output?.ok ? (
          <div className={isStale ? "preview-frame stale" : "preview-frame"}>
            <iframe
              key={output.pdfObjectUrl}
              className="compiled-preview-pdf"
              src={output.pdfObjectUrl}
              title="Compiled LaTeX PDF preview"
            />
            {isCompiling && (
              <div className="preview-compiling-veil" role="status" aria-live="polite">
                <Logo size={56} loop />
                <p>Compiling LaTeX source</p>
              </div>
            )}
          </div>
        ) : isCompiling ? (
          <div className="preview-loading-panel" role="status" aria-live="polite">
            <Logo size={72} loop />
            <p>Compiling LaTeX source</p>
          </div>
        ) : output ? (
          <div className="compile-output-panel" role="status" aria-live="polite">
            <div className="compile-error-head">
              <TriangleAlert size={20} aria-hidden="true" />
              <h2>{output.message}</h2>
            </div>
            {texError && (
              <div className="compile-error-card">
                <code>{texError.message}</code>
                {canJumpToError && (
                  <button
                    type="button"
                    onClick={() => onGoToLine(texError.file, texError.line as number)}
                  >
                    Go to line {texError.line}
                    {texError.file ? ` in ${texError.file}` : ""}
                    <ArrowRight size={15} aria-hidden="true" />
                  </button>
                )}
              </div>
            )}
            {output.log ? (
              <details className="compile-log" open={!texError}>
                <summary>Full compiler log</summary>
                <pre>{output.log}</pre>
              </details>
            ) : (
              <p>Check that the backend container is running.</p>
            )}
          </div>
        ) : (
          <div className="preview-empty-panel">
            <Logo size={64} loop />
            <h2>No compiled PDF yet</h2>
            <p>
              Press Recompile or <kbd>{modKey}</kbd> <kbd>↵</kbd> to see your document here.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
