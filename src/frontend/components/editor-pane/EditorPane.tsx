import { useMemo, useState, type RefObject } from "react";
import { Bold, ChevronDown, ChevronUp, Italic, Search, Type, Underline } from "lucide-react";
import LatexEditor, { type FormatCommand, type LatexEditorHandle } from "@/components/latex-editor/LatexEditor";
import SaveStatus from "@/components/save-status/SaveStatus";
import type { SaveState } from "@/lib/useAutosave";
import "./EditorPane.css";

type Props = {
  editorRef: RefObject<LatexEditorHandle | null>;
  docId: string;
  value: string;
  cursorPosition: number;
  saveState: SaveState;
  modKey: string;
  onChange: (value: string) => void;
  onCursor: (position: number) => void;
  onFormat: (command: FormatCommand) => void;
  onGenerateError: (message: string) => void;
  onCompile: () => void;
};

export default function EditorPane({
  editorRef,
  docId,
  value,
  cursorPosition,
  saveState,
  modKey,
  onChange,
  onCursor,
  onFormat,
  onGenerateError,
  onCompile,
}: Props) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchStatus, setSearchStatus] = useState("");

  const searchMatches = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase();

    if (!needle) {
      return [];
    }

    const haystack = value.toLowerCase();
    const matches: number[] = [];
    let nextIndex = haystack.indexOf(needle);

    while (nextIndex !== -1) {
      matches.push(nextIndex);
      nextIndex = haystack.indexOf(needle, nextIndex + needle.length);
    }

    return matches;
  }, [searchQuery, value]);

  const handleSearch = (direction: "next" | "previous" = "next") => {
    const needle = searchQuery.trim();
    const editor = editorRef.current;

    if (!needle) {
      setSearchStatus("");
      editor?.focus();
      return;
    }

    if (searchMatches.length === 0) {
      setSearchStatus("0/0");
      editor?.focus();
      return;
    }

    const currentSelectionStart = editor?.selectionStart ?? 0;
    const currentSelectionEnd = editor?.selectionEnd ?? 0;
    const currentMatchIndex = searchMatches.findIndex(
      (matchStart) =>
        matchStart === currentSelectionStart && matchStart + needle.length === currentSelectionEnd,
    );
    const fallbackIndex =
      direction === "next"
        ? searchMatches.findIndex((matchStart) => matchStart >= currentSelectionEnd)
        : searchMatches.findLastIndex((matchStart) => matchStart < currentSelectionStart);
    const nextIndex =
      currentMatchIndex === -1
        ? fallbackIndex === -1
          ? direction === "next"
            ? 0
            : searchMatches.length - 1
          : fallbackIndex
        : direction === "next"
          ? (currentMatchIndex + 1) % searchMatches.length
          : (currentMatchIndex - 1 + searchMatches.length) % searchMatches.length;
    const nextMatch = searchMatches[nextIndex];

    editor?.setSelectionRange(nextMatch, nextMatch + needle.length);
    setSearchStatus(`${nextIndex + 1}/${searchMatches.length}`);
  };

  const beforeCursor = value.slice(0, cursorPosition);
  const cursorLine = beforeCursor.split("\n").length;
  const cursorColumn = beforeCursor.length - beforeCursor.lastIndexOf("\n");

  return (
    <section className="editor-pane" aria-label="LaTeX code editor">
      <div className="editor-toolbar" aria-label="Editor formatting toolbar">
        <div className="format-buttons">
          <button
            className="tool-button"
            type="button"
            aria-label="Bold selected text"
            title={`Bold (${modKey}B)`}
            aria-keyshortcuts="Control+B Meta+B"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onFormat("textbf")}
          >
            <Bold size={21} />
          </button>
          <button
            className="tool-button"
            type="button"
            aria-label="Italicize selected text"
            title={`Italic (${modKey}I)`}
            aria-keyshortcuts="Control+I Meta+I"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onFormat("textit")}
          >
            <Italic size={21} />
          </button>
          <button
            className="tool-button boxed"
            type="button"
            aria-label="Underline selected text"
            title={`Underline (${modKey}U)`}
            aria-keyshortcuts="Control+U Meta+U"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onFormat("underline")}
          >
            <Underline size={18} />
          </button>
          <button
            className="tool-button boxed"
            type="button"
            aria-label="Upright Roman text"
            title="Upright Roman text (\\textrm)"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onFormat("textrm")}
          >
            <Type size={18} />
          </button>
        </div>

        <div className="search-field underline-field" role="search">
          <button
            className="search-button"
            type="button"
            aria-label="Search LaTeX source"
            onClick={() => handleSearch("next")}
          >
            <Search size={17} />
          </button>
          <span className="sr-only">Search LaTeX source</span>
          <input
            placeholder="Search"
            value={searchQuery}
            onChange={(event) => {
              setSearchQuery(event.target.value);
              setSearchStatus("");
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                handleSearch(event.shiftKey ? "previous" : "next");
              }
            }}
          />
          {searchStatus && <span className="search-status">{searchStatus}</span>}
          {searchQuery.trim() && (
            <div className="search-nav" aria-label="Search result navigation">
              <button
                className="search-nav-button"
                type="button"
                aria-label="Previous search result"
                disabled={searchMatches.length === 0}
                onClick={() => handleSearch("previous")}
              >
                <ChevronUp size={15} />
              </button>
              <button
                className="search-nav-button"
                type="button"
                aria-label="Next search result"
                disabled={searchMatches.length === 0}
                onClick={() => handleSearch("next")}
              >
                <ChevronDown size={15} />
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="code-surface">
        <LatexEditor
          ref={editorRef}
          docId={docId}
          value={value}
          onChange={onChange}
          onCursor={onCursor}
          onFormat={onFormat}
          onGenerateError={onGenerateError}
          onCompile={onCompile}
        />
      </div>
      <div className="editor-status" aria-label="Editor status">
        <span>
          Ln {cursorLine}, Col {cursorColumn}
        </span>
        <SaveStatus state={saveState} />
        <span className="editor-status-hint">
          <kbd>{modKey}</kbd>
          <kbd>↵</kbd> compile
        </span>
      </div>
    </section>
  );
}
