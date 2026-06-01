import { type ReactNode, useEffect } from "react";

interface ModalProps {
  /** Heading shown at the top of the panel. */
  title: string;
  /** Invoked when the dialog requests close (Escape or a dialog control). */
  onClose: () => void;
  children: ReactNode;
}

/** Minimal modal overlay used by the project dialogs. Closes on Escape. */
export function Modal({ title, onClose, children }: ModalProps) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md rounded-lg border border-border bg-popover p-5 text-popover-foreground shadow-xl"
      >
        <h2 className="text-base font-semibold">{title}</h2>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}
