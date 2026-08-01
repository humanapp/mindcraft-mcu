import { Button } from "@mindcraft-lang/ui";
import { useEffect, useRef, useState } from "react";
import { Modal } from "./Modal";

interface NameInputDialogProps {
  title: string;
  submitLabel: string;
  initialValue?: string;
  onSubmit: (name: string) => Promise<unknown>;
  onClose: () => void;
}

/** Modal that captures a single name and submits the trimmed value. */
export function NameInputDialog({ title, submitLabel, initialValue = "", onSubmit, onClose }: NameInputDialogProps) {
  const [name, setName] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const canSubmit = name.trim().length > 0 && !busy;

  async function submit(): Promise<void> {
    if (!canSubmit) {
      return;
    }
    setBusy(true);
    try {
      await onSubmit(name.trim());
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <input
        ref={inputRef}
        data-testid="name-input"
        aria-label="Name"
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
        placeholder="Name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            void submit();
          }
        }}
      />
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          data-testid="name-submit-button"
          disabled={!canSubmit}
          onClick={() => void submit()}
        >
          {submitLabel}
        </Button>
      </div>
    </Modal>
  );
}
