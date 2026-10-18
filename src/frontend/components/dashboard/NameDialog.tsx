import type { ReactNode } from "react";
import { X } from "lucide-react";

type Props = {
  // "project" or "tag": drives the title, labels and buttons.
  noun: string;
  placeholder: string;
  value: string;
  warning: string;
  help?: ReactNode;
  onChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
};

// The "New project" / "New tag" dialog: one name field.
export default function NameDialog({ noun, placeholder, value, warning, help, onChange, onClose, onSubmit }: Props) {
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <form
        className="new-project-modal"
        aria-label={`Create new ${noun}`}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <header>
          <h2>New {noun}</h2>
          <button
            type="button"
            aria-label={`Close new ${noun} dialog`}
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </header>

        <label>
          {noun[0].toUpperCase() + noun.slice(1)} name
          <input
            autoFocus
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={placeholder}
          />
        </label>

        {help}
        {warning && <p className="modal-warning">{warning}</p>}

        <div className="modal-actions">
          <button
            className="secondary"
            type="button"
            onClick={onClose}
          >
            Cancel
          </button>
          <button type="submit">Create {noun}</button>
        </div>
      </form>
    </div>
  );
}
