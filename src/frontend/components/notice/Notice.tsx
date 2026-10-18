import { X } from "lucide-react";
import "./Notice.css";

export type NoticeMessage = { tone: "error" | "info"; text: string };

export default function Notice({ notice, onDismiss }: { notice: NoticeMessage; onDismiss: () => void }) {
  return (
    <div className={`upload-notice ${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>
      <p>{notice.text}</p>
      <button type="button" aria-label="Dismiss" onClick={onDismiss}>
        <X size={15} />
      </button>
    </div>
  );
}
