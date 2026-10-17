"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  ArrowUp,
  Check,
  Copy,
  LoaderCircle,
  Maximize2,
  Minimize2,
  PenLine,
  RefreshCw,
  Sparkles,
  TriangleAlert,
  WandSparkles,
  X,
} from "lucide-react";
import { apiFetch, apiJson, errorMessage } from "./api";
import "./FigureChat.css";

type ProjectFile = { name: string; content: string };
type Preview = { imageUrl: string } | { error: string };
type Variant = { id: number; code: string; preview?: Preview };
// One exchange: what the user asked, and the variants that came back. `active` = the variant tab on show.
type Turn = {
  id: number;
  request: string;
  prompt: string;
  isRevision: boolean;
  variants: Variant[];
  active: number;
  pending?: boolean;
  error?: string;
};

type Props = {
  open: boolean;
  files: ProjectFile[];
  activeFileName: string;
  onClose: () => void;
};

const STANDALONE = "\\documentclass[tikz,border=4pt]{standalone}";
const PREVIEW_NAME = "__figure_preview__.tex";
const SUGGESTIONS = [
  "A feed-forward neural network with 3 inputs, 4 hidden neurons and 2 outputs",
  "A right triangle with labelled sides a, b, c illustrating Pythagoras",
  "A flowchart of a train, validate and test machine-learning pipeline",
  "A free-body diagram of a block on an inclined plane with friction",
];

// The preamble of the project's main document: the model may only use what it loads, so approved code compiles in place.
const projectPreamble = (files: ProjectFile[], activeFileName: string) => {
  const ordered = [...files].sort((a, b) => Number(b.name === activeFileName) - Number(a.name === activeFileName));
  const main = ordered.find((file) => file.content.includes("\\begin{document}"));
  return main ? main.content.slice(0, main.content.indexOf("\\begin{document}")) : "";
};

const statusOf = (variant: Variant) =>
  !variant.preview ? "compiling" : "imageUrl" in variant.preview ? "ready" : "error";

const shorten = (text: string, max = 42) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

// A tiny node-and-edge diagram that draws itself: the empty state and the "generating" canvas.
function Sketch({ className = "" }: { className?: string }) {
  return (
    <svg className={`fs-sketch ${className}`} viewBox="0 0 220 120" aria-hidden="true">
      <path pathLength={1} d="M42 55 L98 30" style={{ "--d": 0 } as CSSProperties} />
      <path pathLength={1} d="M42 65 L98 90" style={{ "--d": 1 } as CSSProperties} />
      <path pathLength={1} d="M122 30 L178 55" style={{ "--d": 2 } as CSSProperties} />
      <path pathLength={1} d="M122 90 L178 65" style={{ "--d": 3 } as CSSProperties} />
      <path pathLength={1} d="M110 37 C 128 52, 128 68, 110 83" style={{ "--d": 4 } as CSSProperties} />
      <circle cx="30" cy="60" r="12" style={{ "--d": 0 } as CSSProperties} />
      <circle cx="110" cy="25" r="12" style={{ "--d": 1 } as CSSProperties} />
      <circle cx="110" cy="95" r="12" style={{ "--d": 2 } as CSSProperties} />
      <circle cx="190" cy="60" r="12" style={{ "--d": 3 } as CSSProperties} />
    </svg>
  );
}

function Generating({ revision }: { revision: boolean }) {
  return (
    <div className="fs-generating" role="status" aria-live="polite">
      <div className="fs-generating-head">
        <span className="fs-shimmer-text">{revision ? "Revising your figure" : "Sketching variants"}</span>
        <span className="fs-steps" aria-hidden="true">
          <span>Reading the prompt</span>
          <span>Placing nodes</span>
          <span>Drawing edges</span>
          <span>Polishing styles</span>
        </span>
      </div>
      <div className="fs-split">
        <div className="fs-skeleton-code" aria-hidden="true">
          {[68, 52, 84, 46, 74, 38, 60, 30].map((width, index) => (
            <i key={index} style={{ width: `${width}%`, "--i": index } as CSSProperties} />
          ))}
        </div>
        <div className="fs-canvas">
          <Sketch className="fs-sketch-canvas" />
        </div>
      </div>
    </div>
  );
}

export default function FigureChat({ open, files, activeFileName, onClose }: Props) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  // The variant a message refines; null = the message describes a new figure.
  const [base, setBase] = useState<{ turnId: number; variantId: number } | null>(null);
  const [closing, setClosing] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  // Fitted (code scrolls in its box) or expanded (code shows in full). One setting for every variant.
  const [isExpanded, setIsExpanded] = useState(false);
  const nextId = useRef(0);
  // Every compile goes through one queue: the backend only runs a couple at once and answers 503 beyond that.
  const compileQueue = useRef<Promise<unknown>>(Promise.resolve());
  const logRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const isBusy = turns.some((turn) => turn.pending);
  const baseTurn = base && turns.find((turn) => turn.id === base.turnId);
  const baseVariant = baseTurn?.variants.find((variant) => variant.id === base?.variantId);
  const baseLabel =
    baseTurn && baseVariant
      ? `${baseTurn.variants.length > 1 ? `Variant ${baseTurn.variants.indexOf(baseVariant) + 1}` : "Revised figure"} · ${shorten(baseTurn.request)}`
      : "";

  // A new message scrolls the conversation so it starts at the top, like a chat.
  useEffect(() => {
    logRef.current?.lastElementChild?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [turns.length]);

  // Opening focuses the composer; Escape closes.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => composerRef.current?.focus());
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setClosing(true);
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const updateTurn = (turnId: number, patch: (turn: Turn) => Partial<Turn>) =>
    setTurns((all) => all.map((turn) => (turn.id === turnId ? { ...turn, ...patch(turn) } : turn)));

  const updateVariant = (turnId: number, variantId: number, patch: Partial<Variant>) =>
    updateTurn(turnId, (turn) => ({
      variants: turn.variants.map((variant) => (variant.id === variantId ? { ...variant, ...patch } : variant)),
    }));

  // Preview = the project's preamble on a standalone page: cropped to the figure, but compiled like it will be in the project.
  // ponytail: preamble packages that clash with standalone (rare) break the preview; fall back to a bare preamble if that bites.
  const compile = async (code: string): Promise<Preview> => {
    const preamble = projectPreamble(files, activeFileName);
    const head = (
      /\\documentclass/.test(preamble)
        ? preamble.replace(/\\documentclass\s*(\[[^\]]*\])?\s*\{[^}]*\}/, STANDALONE)
        : `${STANDALONE}\n`
    )
      // geometry's page margins shift the figure off standalone's cropped page; it only affects layout, never the figure.
      // ponytail: misses geometry loaded inside a multi-package \usepackage{a,geometry}; split that out if it bites.
      .replace(/\\usepackage\s*(\[[^\]]*\])?\s*\{geometry\}/g, "")
      .replace(/\\(?:new)?geometry\s*\{[^}]*\}/g, "");
    try {
      // Project files go along so \input and custom .sty files in the preamble still resolve.
      // PNG, not PDF: a plain image shows just the figure, without the browser's PDF viewer around it.
      const response = await apiFetch("/api/v1/compile?format=png", {
        method: "POST",
        body: JSON.stringify({
          mainFileName: PREVIEW_NAME,
          files: [...files, { name: PREVIEW_NAME, content: `${head}\\begin{document}\n${code}\n\\end{document}\n` }],
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        // The first error line of the TeX log names the actual mistake: "! ..." or, with -file-line-error,
        // "./file.tex:12: ...". The file and line refer to the preview wrapper, so they are dropped.
        const errorLine = /^(?:!|\S+\.tex:\d+: )/;
        const lines = ((body?.error?.log as string | undefined) ?? "").split("\n");
        let at = lines.findIndex((line) => errorLine.test(line));
        let texError = at === -1 ? "" : lines[at];
        // TeX hard-wraps its log at 79 characters, so a long message continues on the next lines.
        while (at !== -1 && lines[at].length === 79 && at + 1 < lines.length) texError += lines[++at];
        texError = texError.replace(errorLine, "").trim();
        return { error: texError || body?.error?.message || `Compile failed (${response.status}).` };
      }
      return { imageUrl: URL.createObjectURL(await response.blob()) };
    } catch {
      return { error: "The server could not be reached." };
    }
  };

  // ponytail: each variant costs one compile against the per-minute compile limit; batch server-side if that bites.
  const preview = (turnId: number, variant: Variant) => {
    if (variant.preview && "imageUrl" in variant.preview) URL.revokeObjectURL(variant.preview.imageUrl);
    updateVariant(turnId, variant.id, { preview: undefined });
    const job = compileQueue.current.then(() => compile(variant.code));
    compileQueue.current = job;
    void job.then((result) => updateVariant(turnId, variant.id, { preview: result }));
  };

  const copy = async (variant: Variant) => {
    try {
      await navigator.clipboard.writeText(variant.code);
      setCopiedId(variant.id);
      setTimeout(() => setCopiedId((current) => (current === variant.id ? null : current)), 1600);
    } catch {
      // Clipboard blocked (insecure origin or denied): the code is still selectable in the editor box.
    }
  };

  const send = async () => {
    const request = draft.trim();
    if (!request || isBusy) return;
    const turnId = ++nextId.current;
    const isRevision = Boolean(baseTurn && baseVariant);
    const prompt = baseTurn && baseVariant ? baseTurn.prompt : request;
    const revision = baseVariant ? { code: baseVariant.code, change: request } : {};
    setTurns((all) => [...all, { id: turnId, request, prompt, isRevision, variants: [], active: 0, pending: true }]);
    setDraft("");

    try {
      const { variants: codes } = await apiJson<{ variants: string[] }>("/api/v1/generate/tikz", {
        method: "POST",
        body: JSON.stringify({ prompt, preamble: projectPreamble(files, activeFileName).slice(-8000), ...revision }),
      });
      const variants = codes.map((code) => ({ id: ++nextId.current, code }));
      updateTurn(turnId, () => ({ variants, pending: false }));
      variants.forEach((variant) => preview(turnId, variant));
      // A revision is a one-answer reply: keep refining it by default, like a chat.
      setBase(isRevision ? { turnId, variantId: variants[0].id } : null);
    } catch (error) {
      updateTurn(turnId, () => ({ pending: false, error: errorMessage(error) }));
    }
  };

  return (
    <div
      className={closing ? "fs-backdrop closing" : "fs-backdrop"}
      role="presentation"
      hidden={!open}
      onMouseDown={(event) => event.target === event.currentTarget && setClosing(true)}
    >
      <div
        className="fs-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fs-title"
        onAnimationEnd={(event) => {
          // The exit animation finished: now actually hide.
          if (closing && event.target === event.currentTarget) {
            setClosing(false);
            onClose();
          }
        }}
      >
        <div className="fs-aurora" aria-hidden="true" />

        <header className="fs-header">
          <span className="fs-badge" aria-hidden="true">
            <Sparkles size={17} />
          </span>
          <div className="fs-heading">
            <h2 id="fs-title">Figure Studio</h2>
            <p>Describe a figure, get TikZ you can drop into your project</p>
          </div>
          <button className="fs-close" type="button" aria-label="Close figure studio" onClick={() => setClosing(true)}>
            <X size={17} />
          </button>
        </header>

        <div className="fs-log" ref={logRef}>
          {turns.length === 0 && (
            <div className="fs-empty">
              <Sketch className="fs-sketch-hero" />
              <h3>What shall we draw?</h3>
              <p>Describe a scientific figure and get several TikZ takes on it. Refine any of them by chatting.</p>
              <div className="fs-suggestions">
                {SUGGESTIONS.map((suggestion, index) => (
                  <button
                    key={suggestion}
                    type="button"
                    style={{ "--i": index } as CSSProperties}
                    onClick={() => {
                      setDraft(suggestion);
                      composerRef.current?.focus();
                    }}
                  >
                    <WandSparkles size={15} aria-hidden="true" />
                    <span>{suggestion}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {turns.map((turn) => {
            const variant = turn.variants[turn.active];
            const isMulti = turn.variants.length > 1;
            return (
              <div className="fs-turn" key={turn.id}>
                <div className="fs-user">
                  <p className="fs-bubble">
                    {turn.isRevision && <PenLine size={13} aria-label="Change request" />}
                    {turn.request}
                  </p>
                </div>

                <div className="fs-assistant">
                  <span className={turn.pending ? "fs-avatar thinking" : "fs-avatar"} aria-hidden="true">
                    <Sparkles size={14} />
                  </span>
                  <div className="fs-reply">
                    {turn.pending && <Generating revision={turn.isRevision} />}

                    {turn.error && (
                      <div className="fs-error" role="alert">
                        <TriangleAlert size={16} aria-hidden="true" />
                        <span>{turn.error}</span>
                      </div>
                    )}

                    {variant && (
                      <>
                        {isMulti && (
                          <div className="fs-pills" role="tablist" aria-label="Variants">
                            {turn.variants.map((item, index) => {
                              const isBase = base?.turnId === turn.id && base.variantId === item.id;
                              return (
                                <button
                                  key={item.id}
                                  className="fs-pill"
                                  type="button"
                                  role="tab"
                                  aria-selected={index === turn.active}
                                  aria-label={`Variant ${index + 1}, ${statusOf(item)}${isBase ? ", refining" : ""}`}
                                  data-state={statusOf(item)}
                                  style={{ "--i": index } as CSSProperties}
                                  onClick={() => updateTurn(turn.id, () => ({ active: index }))}
                                >
                                  <span className="fs-dot" />
                                  {index + 1}
                                  {isBase && <PenLine size={11} />}
                                </button>
                              );
                            })}
                          </div>
                        )}

                        {(() => {
                          const isBase = base?.turnId === turn.id && base.variantId === variant.id;
                          const status = statusOf(variant);
                          const name = isMulti ? `Variant ${turn.active + 1}` : "Revised figure";
                          return (
                            // Keyed by variant so switching tabs replays the entrance animation.
                            <section className={isBase ? "fs-variant refining" : "fs-variant"} key={variant.id} aria-label={name}>
                              <div className="fs-toolbar">
                                <h4>
                                  {name}
                                  <span className="fs-status" data-state={status}>
                                    <span className="fs-dot" />
                                    {status === "compiling" ? "Compiling" : status === "ready" ? "Compiled" : "Error"}
                                  </span>
                                </h4>
                                <button
                                  className="fs-tool"
                                  type="button"
                                  aria-pressed={isExpanded}
                                  title={isExpanded ? "Fit the code to the window" : "Show the whole code"}
                                  onClick={() => setIsExpanded((value) => !value)}
                                >
                                  {isExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                                  {isExpanded ? "Collapse" : "Expand"}
                                </button>
                                <button className="fs-tool" type="button" onClick={() => void copy(variant)}>
                                  {copiedId === variant.id ? <Check size={14} className="fs-copied" /> : <Copy size={14} />}
                                  {copiedId === variant.id ? "Copied" : "Copy"}
                                </button>
                                <button
                                  className="fs-tool"
                                  type="button"
                                  disabled={status === "compiling"}
                                  onClick={() => preview(turn.id, variant)}
                                >
                                  <RefreshCw size={14} className={status === "compiling" ? "fs-spin" : ""} />
                                  Recompile
                                </button>
                                <button
                                  className="fs-tool primary"
                                  type="button"
                                  aria-pressed={isBase}
                                  onClick={() => {
                                    setBase(isBase ? null : { turnId: turn.id, variantId: variant.id });
                                    if (!isBase) composerRef.current?.focus();
                                  }}
                                >
                                  <PenLine size={14} />
                                  {isBase ? "Refining" : "Refine"}
                                </button>
                              </div>

                              {/* Code and canvas share one grid row, so they are always the same size. */}
                              <div className={isExpanded ? "fs-split expanded" : "fs-split"}>
                                <textarea
                                  className="fs-code"
                                  aria-label={`${name} code`}
                                  spellCheck={false}
                                  rows={variant.code.split("\n").length}
                                  value={variant.code}
                                  onChange={(event) => updateVariant(turn.id, variant.id, { code: event.target.value })}
                                />
                                <div className="fs-canvas" data-state={status}>
                                  {!variant.preview ? (
                                    <div className="fs-compiling">
                                      <span className="fs-spinner" />
                                      Compiling preview
                                    </div>
                                  ) : "imageUrl" in variant.preview ? (
                                    <div className="fs-paper">
                                      <img src={variant.preview.imageUrl} alt={`${name} rendered`} />
                                    </div>
                                  ) : (
                                    <div className="fs-compile-error">
                                      <TriangleAlert size={20} aria-hidden="true" />
                                      <strong>Didn’t compile</strong>
                                      <code>{variant.preview.error}</code>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </section>
                          );
                        })()}
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <form
          className="fs-composer"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          {baseLabel && (
            <div className="fs-chip" key={`${base?.turnId}-${base?.variantId}`}>
              <PenLine size={13} aria-hidden="true" />
              Refining <strong>{baseLabel}</strong>
              <button type="button" aria-label="Stop refining, describe a new figure" onClick={() => setBase(null)}>
                <X size={12} />
              </button>
            </div>
          )}
          <div className={isBusy ? "fs-input busy" : "fs-input"}>
            <textarea
              ref={composerRef}
              rows={1}
              maxLength={2000}
              value={draft}
              aria-label={baseLabel ? "Change request" : "Figure description"}
              placeholder={baseLabel ? "What should change? e.g. make the arrows thicker" : "Describe the figure you need…"}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                // Enter sends, Shift+Enter is a new line, like other chat apps.
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <button className="fs-send" type="submit" aria-label="Send" disabled={isBusy || !draft.trim()}>
              {isBusy ? <LoaderCircle size={18} className="fs-spin" /> : <ArrowUp size={18} strokeWidth={2.6} />}
            </button>
          </div>
          <p className="fs-hint">
            <kbd>Enter</kbd> to send · <kbd>Shift</kbd> + <kbd>Enter</kbd> for a new line · <kbd>Esc</kbd> to close
          </p>
        </form>
      </div>
    </div>
  );
}
