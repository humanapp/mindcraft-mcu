import { Check, Pencil } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface InlineRenameProps {
  value: string;
  /** Describes the renamed thing for aria-labels, e.g. "project name". */
  ariaLabel: string;
  onRename: (name: string) => Promise<unknown>;
}

/**
 * Inline editable name. Shows the value with a pencil button; click to edit,
 * Enter or the check to save, Escape or blur to cancel.
 */
export function InlineRename({ value, ariaLabel, onRename }: InlineRenameProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  function startEditing(): void {
    setDraft(value);
    setEditing(true);
  }

  async function commit(): Promise<void> {
    const name = draft.trim();
    setEditing(false);
    if (name && name !== value) {
      await onRename(name);
    }
  }

  if (!editing) {
    return (
      <span className="inline-flex items-center gap-1">
        <span className="text-sm text-muted-foreground">{value}</span>
        <button
          type="button"
          data-testid="inline-rename-edit"
          aria-label={`Edit ${ariaLabel}`}
          className="rounded p-0.5 text-muted-foreground hover:text-foreground"
          onClick={startEditing}
        >
          <Pencil className="size-3.5" />
        </button>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      <input
        ref={inputRef}
        data-testid="inline-rename-input"
        aria-label={ariaLabel}
        className="w-44 rounded border border-input bg-background px-2 py-0.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            void commit();
          } else if (event.key === "Escape") {
            setEditing(false);
          }
        }}
        onBlur={() => setEditing(false)}
      />
      <button
        type="button"
        data-testid="inline-rename-save"
        aria-label={`Save ${ariaLabel}`}
        className="rounded p-0.5 text-success hover:text-success/80"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => void commit()}
      >
        <Check className="size-4" />
      </button>
    </span>
  );
}
