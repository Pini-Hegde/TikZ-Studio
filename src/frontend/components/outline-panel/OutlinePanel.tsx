import { useMemo } from "react";
import { ChevronDown } from "lucide-react";
import { buildOutline, type OutlineItem } from "@/lib/latexOutline";
import type { ProjectFile } from "@/lib/projects";
import "./OutlinePanel.css";

type Props = {
  activeFile: ProjectFile | undefined;
  files: ProjectFile[];
  isTexFile: boolean;
  cursorPosition: number;
  // Folded headings live with the page, so they survive the sidebar being hidden.
  collapsedIds: Set<string>;
  onToggle: (id: string) => void;
  onJump: (item: OutlineItem) => void;
};

export default function OutlinePanel({ activeFile, files, isTexFile, cursorPosition, collapsedIds, onToggle, onJump }: Props) {
  const outlineItems = useMemo(
    () => (isTexFile && activeFile ? buildOutline(activeFile.id, files) : []),
    [isTexFile, activeFile, files],
  );
  const outlineById = useMemo(
    () => new Map(outlineItems.map((item) => [item.id, item])),
    [outlineItems],
  );
  const isOutlineHidden = (item: OutlineItem) => {
    for (let id = item.parentId; id; id = outlineById.get(id)?.parentId ?? null) {
      if (collapsedIds.has(id)) {
        return true;
      }
    }
    return false;
  };
  // The heading the cursor sits under; if it is folded away, its nearest visible ancestor.
  let activeOutline = outlineItems.findLast((item) => item.anchor <= cursorPosition);
  while (activeOutline?.parentId && isOutlineHidden(activeOutline)) {
    activeOutline = outlineById.get(activeOutline.parentId);
  }
  const activeOutlineId = activeOutline?.id ?? null;

  return (
    <details className="section-layout" open>
      <summary className="panel-title">
        <ChevronDown className="panel-chevron" size={14} strokeWidth={2.6} aria-hidden />
        File outline
      </summary>
      <div className="outline-list">
        {outlineItems.length > 0 ? (
          outlineItems.map((item) =>
            isOutlineHidden(item) ? null : (
              <div
                className={item.id === activeOutlineId ? "outline-row active" : "outline-row"}
                key={item.id}
                style={{ paddingLeft: 6 + item.depth * 14 }}
              >
                {item.hasChildren ? (
                  <button
                    className="outline-toggle"
                    type="button"
                    aria-label={`${collapsedIds.has(item.id) ? "Expand" : "Collapse"} ${item.title}`}
                    aria-expanded={!collapsedIds.has(item.id)}
                    onClick={() => onToggle(item.id)}
                  >
                    <ChevronDown size={13} strokeWidth={2.6} aria-hidden />
                  </button>
                ) : (
                  <span className="outline-toggle" aria-hidden />
                )}
                <button
                  className="outline-item"
                  data-level={item.level}
                  type="button"
                  title={`\\${item.command} · line ${item.line}`}
                  onClick={() => onJump(item)}
                >
                  {item.title}
                </button>
              </div>
            ),
          )
        ) : (
          <p className="empty-outline">
            {isTexFile ? "No sections" : "Outline available for .tex files"}
          </p>
        )}
      </div>
    </details>
  );
}
