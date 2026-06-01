import { Button } from "@mindcraft-lang/ui";
import { useState, useSyncExternalStore } from "react";
import { useMicrobitSimEnvironment } from "@/contexts/microbit-sim-environment";
import { BrainEditor } from "./BrainEditor";
import { ConfirmDialog } from "./ConfirmDialog";
import { NameInputDialog } from "./NameInputDialog";

type BrainDialog =
  | { kind: "add" }
  | { kind: "rename"; id: string; name: string }
  | { kind: "remove"; id: string; name: string }
  | null;

/** User-managed brain list: add, select, rename, and remove brains. */
export function BrainList() {
  const store = useMicrobitSimEnvironment();
  const brains = useSyncExternalStore(store.subscribeToBrains, store.getBrains);
  const selectedId = useSyncExternalStore(store.subscribeToBrains, store.getSelectedBrainId);
  const [dialog, setDialog] = useState<BrainDialog>(null);
  const [editingBrainId, setEditingBrainId] = useState<string | null>(null);

  return (
    <section className="max-w-md">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Brains</h2>
        <Button type="button" size="sm" data-testid="add-brain-button" onClick={() => setDialog({ kind: "add" })}>
          Add brain
        </Button>
      </div>

      {brains.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No brains yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {brains.map((brain) => (
            <li
              key={brain.id}
              data-testid="brain-item"
              data-brain-name={brain.name}
              className="flex items-center justify-between py-2"
            >
              <button
                type="button"
                data-testid="brain-select"
                data-brain-name={brain.name}
                className={`flex-1 text-left text-sm ${brain.id === selectedId ? "font-semibold" : ""}`}
                onClick={() => store.selectBrain(brain.id)}
              >
                {brain.name}
                {brain.id === selectedId && <span className="ml-2 text-xs text-muted-foreground">selected</span>}
              </button>
              <div className="flex gap-3">
                <button
                  type="button"
                  data-testid="brain-edit"
                  data-brain-name={brain.name}
                  className="text-xs font-medium text-foreground hover:underline"
                  onClick={() => setEditingBrainId(brain.id)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  data-testid="brain-rename"
                  data-brain-name={brain.name}
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setDialog({ kind: "rename", id: brain.id, name: brain.name })}
                >
                  Rename
                </button>
                <button
                  type="button"
                  data-testid="brain-remove"
                  data-brain-name={brain.name}
                  className="text-xs text-destructive hover:text-destructive/80"
                  onClick={() => setDialog({ kind: "remove", id: brain.id, name: brain.name })}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {dialog?.kind === "add" && (
        <NameInputDialog
          title="Add brain"
          submitLabel="Add"
          onSubmit={(name) => store.addBrain(name)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "rename" && (
        <NameInputDialog
          title="Rename brain"
          submitLabel="Rename"
          initialValue={dialog.name}
          onSubmit={(name) => store.renameBrain(dialog.id, name)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "remove" && (
        <ConfirmDialog
          title="Delete brain"
          message={`Delete "${dialog.name}"? This cannot be undone.`}
          confirmLabel="Delete"
          destructive
          onConfirm={() => store.removeBrain(dialog.id)}
          onClose={() => setDialog(null)}
        />
      )}
      {editingBrainId && <BrainEditor brainId={editingBrainId} onClose={() => setEditingBrainId(null)} />}
    </section>
  );
}
