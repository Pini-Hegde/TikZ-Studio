import type { ReactNode } from "react";
import { PanelLeftClose, PanelLeftOpen, Sparkles } from "lucide-react";
import Logo from "@/components/logo/Logo";
import "./FileRail.css";

type Props = {
  projectTitle: string | undefined;
  isCollapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  modKey: string;
  onHome: () => void;
  onFigure: () => void;
  // File tree and outline, shown while the rail is open.
  children: ReactNode;
  // Always shown at the bottom (the profile menu).
  footer: ReactNode;
};

export default function FileRail({ projectTitle, isCollapsed, onCollapsedChange, modKey, onHome, onFigure, children, footer }: Props) {
  return (
    <aside className={isCollapsed ? "file-rail collapsed" : "file-rail"} aria-label="Project navigation">
      <div className="rail-toolbar">
        <button
          className="home-logo-button"
          type="button"
          aria-label="Home"
          title="Home"
          onClick={onHome}
        >
          <Logo size={34} loop />
        </button>
        {!isCollapsed && (
          <>
            <span className="rail-project-title" title={projectTitle}>
              {projectTitle}
            </span>
            <button
              className="rail-toggle"
              type="button"
              aria-label="Hide files"
              aria-expanded="true"
              title={`Hide files (${modKey}\\)`}
              onClick={() => onCollapsedChange(true)}
            >
              <PanelLeftClose size={17} />
            </button>
          </>
        )}
      </div>

      {isCollapsed ? (
        <div className="rail-mini">
          <button
            className="rail-toggle"
            type="button"
            aria-label="Show files"
            aria-expanded="false"
            title={`Show files (${modKey}\\)`}
            onClick={() => onCollapsedChange(false)}
          >
            <PanelLeftOpen size={17} />
          </button>
          <button
            className="rail-toggle"
            type="button"
            aria-label="Generate TikZ figure"
            title="Generate TikZ figure"
            onClick={onFigure}
          >
            <Sparkles size={16} />
          </button>
        </div>
      ) : (
        children
      )}

      {footer}
    </aside>
  );
}
