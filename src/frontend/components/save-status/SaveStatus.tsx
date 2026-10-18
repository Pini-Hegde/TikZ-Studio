import type { ReactNode } from "react";
import { saveLabel, type SaveState } from "@/lib/useAutosave";
import "./SaveStatus.css";

export default function SaveStatus({ state, children }: { state: SaveState; children?: ReactNode }) {
  return (
    <span className="save-status">
      <span className={`save-dot ${state.status}`} aria-hidden="true" />
      {children}
      {saveLabel(state)}
    </span>
  );
}
