"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  ArrowDownToLine,
  ArrowUp,
  Check,
  Copy,
  Eye,
  History,
  LoaderCircle,
  Maximize2,
  MessageSquare,
  Minimize2,
  Pencil,
  PenLine,
  RefreshCw,
  SquarePen,
  Trash2,
  TriangleAlert,
  WandSparkles,
  X,
} from "lucide-react";
import { ApiError, apiFetch, apiJson, errorMessage } from "@/lib/api";
import Logo from "@/components/logo/Logo";
import "./FigureChat.css";

type ProjectFile = { name: string; content: string };
// "idle" = not compiled yet (a variant restored from history; compiled when it is looked at).
type Preview = { imageUrl: string } | { error: string } | { idle: true };
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
  projectId?: string;
  onClose: () => void;
  onInsert: (code: string) => void;
};

// History: one list per user, saved in Supabase (backend/figure_chats). Only code is stored, never images.
type ChatSummary = { id: string; title: string; projectId: string | null; updatedAt: string };
type StoredTurn = { request: string; prompt: string; isRevision: boolean; variants: { code: string }[]; active: number; error: string | null };
type StoredChat = ChatSummary & { turns: StoredTurn[]; refining: { turn: number; variant: number } | null };

const newChatId = () =>
  typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16));

// Today / Yesterday / Previous 7 days / Older, like other chat apps.
const dayGroup = (iso: string) => {
  const day = 24 * 60 * 60 * 1000;
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  const at = new Date(iso).getTime();
  if (at >= startOfToday) return "Today";
  if (at >= startOfToday - day) return "Yesterday";
  if (at >= startOfToday - 7 * day) return "Previous 7 days";
  return "Older";
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
  !variant.preview ? "compiling" : "idle" in variant.preview ? "idle" : "imageUrl" in variant.preview ? "ready" : "error";

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
        {/* The logo retells its story (code → figure → sparkle) for as long as the model is working. */}
        <div className="fs-canvas">
          <div className="fs-gen-logo">
            <Logo size={96} loop />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function FigureChat({ open, files, activeFileName, projectId, onClose, onInsert }: Props) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [chatId, setChatId] = useState(newChatId);
  const [chatTitle, setChatTitle] = useState(""); // set by renaming; otherwise the first prompt names the chat
  const [chatProjectId, setChatProjectId] = useState<string | undefined>(projectId);
  const [chats, setChats] = useState<ChatSummary[] | null>(null); // null = still loading
  const [historyNote, setHistoryNote] = useState("");
  // Open beside the chat on wide screens; on phones it would cover the conversation, so it starts closed.
  const [isHistoryOpen, setIsHistoryOpen] = useState(() => typeof window === "undefined" || window.matchMedia("(min-width: 721px)").matches);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const lastSaved = useRef(""); // the serialized chat as last saved, so unchanged chats aren't re-saved
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

  // Load the history list whenever Figure Studio opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    apiJson<{ chats: ChatSummary[] }>("/api/v1/figure-chats")
      .then(({ chats: list }) => {
        if (cancelled) return;
        setChats(list);
        setHistoryNote("");
      })
      .catch((error) => {
        if (cancelled) return;
        setChats([]);
        setHistoryNote(errorMessage(error));
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const autoTitle = turns[0] ? shorten(turns[0].request.replace(/\s+/g, " "), 60) : "";
  const title = chatTitle || autoTitle;
  const settled = turns.filter((turn) => !turn.pending);
  const serialized = settled.length
    ? JSON.stringify({
        title,
        projectId: chatProjectId ?? null,
        turns: settled.map((turn) => ({
          request: turn.request,
          prompt: turn.prompt,
          isRevision: turn.isRevision,
          variants: turn.variants.map((variant) => ({ code: variant.code })),
          active: turn.active,
          error: turn.error ?? null,
        })),
        refining: (() => {
          const turnIndex = settled.findIndex((turn) => turn.id === base?.turnId);
          const variantIndex = turnIndex === -1 ? -1 : settled[turnIndex].variants.findIndex((variant) => variant.id === base?.variantId);
          return variantIndex === -1 ? null : { turn: turnIndex, variant: variantIndex };
        })(),
      })
    : "";

  // Autosave a moment after the conversation changes (never mid-generation, never when nothing changed).
  useEffect(() => {
    if (!serialized || serialized === lastSaved.current || isBusy) return;
    const timer = window.setTimeout(() => {
      apiFetch(`/api/v1/figure-chats/${chatId}`, { method: "PUT", body: serialized })
        .then(async (response) => {
          if (!response.ok) {
            const body = await response.json().catch(() => null);
            throw new ApiError(response.status, body?.error?.message ?? "The chat could not be saved.");
          }
          lastSaved.current = serialized;
          setHistoryNote("");
          const summary = { id: chatId, title: JSON.parse(serialized).title, projectId: chatProjectId ?? null, updatedAt: new Date().toISOString() };
          setChats((list) => [summary, ...(list ?? []).filter((chat) => chat.id !== chatId)]);
        })
        .catch((error) => setHistoryNote(errorMessage(error)));
    }, 800);
    return () => window.clearTimeout(timer);
  }, [serialized, chatId, chatProjectId, isBusy]);

  const releasePreviews = () =>
    turns.forEach((turn) =>
      turn.variants.forEach((variant) => variant.preview && "imageUrl" in variant.preview && URL.revokeObjectURL(variant.preview.imageUrl)),
    );

  const startNewChat = () => {
    if (isBusy) return;
    releasePreviews();
    setTurns([]);
    setBase(null);
    setChatId(newChatId());
    setChatTitle("");
    setChatProjectId(projectId);
    lastSaved.current = "";
    setDraft("");
    composerRef.current?.focus();
  };

  const openChat = async (id: string) => {
    if (isBusy || id === chatId) return;
    try {
      const chat = await apiJson<StoredChat>(`/api/v1/figure-chats/${id}`);
      releasePreviews();
      const restored: Turn[] = chat.turns.map((turn) => ({
        id: ++nextId.current,
        request: turn.request,
        prompt: turn.prompt,
        isRevision: turn.isRevision,
        active: Math.min(turn.active, Math.max(0, turn.variants.length - 1)),
        error: turn.error ?? undefined,
        variants: turn.variants.map((variant) => ({ id: ++nextId.current, code: variant.code, preview: { idle: true } })),
      }));
      const refiningTurn = chat.refining ? restored[chat.refining.turn] : undefined;
      const refiningVariant = refiningTurn?.variants[chat.refining?.variant ?? -1];
      setTurns(restored);
      setBase(refiningTurn && refiningVariant ? { turnId: refiningTurn.id, variantId: refiningVariant.id } : null);
      setChatId(chat.id);
      setChatTitle(chat.title);
      setChatProjectId(chat.projectId ?? undefined);
      // Matches what `serialized` will compute, so reopening alone doesn't count as a change.
      lastSaved.current = JSON.stringify({
        title: chat.title,
        projectId: chat.projectId ?? null,
        turns: chat.turns.map((turn) => ({ ...turn, error: turn.error ?? null })),
        refining: chat.refining,
      });
      // Compile only what is on screen: the shown variant of the latest two replies.
      restored.slice(-2).forEach((turn) => turn.variants[turn.active] && preview(turn.id, turn.variants[turn.active]));
    } catch (error) {
      setHistoryNote(errorMessage(error));
    }
  };

  const deleteChat = async (chat: ChatSummary) => {
    if (!window.confirm(`Delete the chat "${chat.title}"? This can't be undone.`)) return;
    try {
      await apiJson(`/api/v1/figure-chats/${chat.id}`, { method: "DELETE" });
      setChats((list) => (list ?? []).filter((item) => item.id !== chat.id));
      if (chat.id === chatId) startNewChat();
    } catch (error) {
      setHistoryNote(errorMessage(error));
    }
  };

  const commitRename = async () => {
    if (!renaming) return;
    const value = renaming.value.trim().slice(0, 200);
    setRenaming(null);
    if (!value) return;
    if (renaming.id === chatId) {
      setChatTitle(value); // the autosave carries it
      return;
    }
    try {
      // Another chat: load it, then save it back with the new name.
      const chat = await apiJson<StoredChat>(`/api/v1/figure-chats/${renaming.id}`);
      await apiJson(`/api/v1/figure-chats/${chat.id}`, {
        method: "PUT",
        body: JSON.stringify({ title: value, projectId: chat.projectId, turns: chat.turns, refining: chat.refining }),
      });
      setChats((list) => (list ?? []).map((item) => (item.id === chat.id ? { ...item, title: value } : item)));
    } catch (error) {
      setHistoryNote(errorMessage(error));
    }
  };

  const groups = (chats ?? []).reduce<[string, ChatSummary[]][]>((acc, chat) => {
    const label = dayGroup(chat.updatedAt);
    const last = acc[acc.length - 1];
    if (last && last[0] === label) last[1].push(chat);
    else acc.push([label, [chat]]);
    return acc;
  }, []);

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
          {/* Mounted only while open, so the logo plays its story each time Figure Studio opens. */}
          <span className="fs-logo" aria-hidden="true">
            {open && <Logo size={38} loop />}
          </span>
          <div className="fs-heading">
            <h2 id="fs-title">Figure Studio</h2>
            <p>Describe a figure, get TikZ you can drop into your project</p>
          </div>
          <button
            className="fs-header-tool"
            type="button"
            aria-pressed={isHistoryOpen}
            aria-label={isHistoryOpen ? "Hide history" : "Show history"}
            title={isHistoryOpen ? "Hide history" : "Show history"}
            onClick={() => setIsHistoryOpen((value) => !value)}
          >
            <History size={17} />
          </button>
          <button
            className="fs-header-tool"
            type="button"
            aria-label="New chat"
            title="New chat"
            disabled={isBusy}
            onClick={startNewChat}
          >
            <SquarePen size={17} />
          </button>
          <button className="fs-close" type="button" aria-label="Close figure studio" onClick={() => setClosing(true)}>
            <X size={17} />
          </button>
        </header>

        <div className="fs-body">
        {isHistoryOpen && (
          <aside className="fs-history" aria-label="Figure chat history">
            <button className="fs-new-chat" type="button" disabled={isBusy} onClick={startNewChat}>
              <SquarePen size={15} aria-hidden="true" />
              New chat
            </button>
            {chats === null ? (
              <div className="fs-history-loading" aria-label="Loading history">
                <i />
                <i />
                <i />
              </div>
            ) : chats.length === 0 && !historyNote ? (
              <p className="fs-history-empty">Your figure chats will appear here.</p>
            ) : (
              groups.map(([label, items]) => (
                <section className="fs-history-group" key={label} aria-label={label}>
                  <h3>{label}</h3>
                  {items.map((chat) =>
                    renaming?.id === chat.id ? (
                      <input
                        key={chat.id}
                        className="fs-history-rename"
                        autoFocus
                        aria-label="Chat name"
                        value={renaming.value}
                        onChange={(event) => setRenaming({ id: chat.id, value: event.target.value })}
                        onBlur={() => void commitRename()}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") void commitRename();
                          if (event.key === "Escape") {
                            event.stopPropagation();
                            setRenaming(null);
                          }
                        }}
                      />
                    ) : (
                      <div key={chat.id} className={chat.id === chatId ? "fs-history-item active" : "fs-history-item"}>
                        <button type="button" className="fs-history-open" disabled={isBusy} title={chat.title} onClick={() => void openChat(chat.id)}>
                          <MessageSquare size={14} aria-hidden="true" />
                          <span>{chat.id === chatId ? title || chat.title : chat.title}</span>
                        </button>
                        <button type="button" className="fs-history-action" aria-label={`Rename ${chat.title}`} onClick={() => setRenaming({ id: chat.id, value: chat.id === chatId ? title : chat.title })}>
                          <Pencil size={13} />
                        </button>
                        <button type="button" className="fs-history-action danger" aria-label={`Delete ${chat.title}`} onClick={() => void deleteChat(chat)}>
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ),
                  )}
                </section>
              ))
            )}
            {historyNote && <p className="fs-history-note" role="status">{historyNote}</p>}
          </aside>
        )}
        <div className="fs-main">
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
                  {/* Loops while this reply is being generated, then settles into the finished mark. */}
                  <span className={turn.pending ? "fs-avatar thinking" : "fs-avatar"} aria-hidden="true">
                    <Logo size={30} loop />
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
                                  onClick={() => {
                                    updateTurn(turn.id, () => ({ active: index }));
                                    if (statusOf(item) === "idle") preview(turn.id, item); // restored from history
                                  }}
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
                                    {status === "compiling" ? "Compiling" : status === "ready" ? "Compiled" : status === "idle" ? "Not compiled" : "Error"}
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
                                <button
                                  className="fs-tool insert"
                                  type="button"
                                  title={`Insert at the cursor in ${activeFileName || "the open file"}`}
                                  onClick={() => {
                                    onInsert(variant.code);
                                    setClosing(true);
                                  }}
                                >
                                  <ArrowDownToLine size={14} />
                                  Insert
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
                                  ) : "idle" in variant.preview ? (
                                    <div className="fs-compiling idle">
                                      <button className="fs-tool" type="button" onClick={() => preview(turn.id, variant)}>
                                        <Eye size={14} />
                                        Show preview
                                      </button>
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
      </div>
    </div>
  );
}
