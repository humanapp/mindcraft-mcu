import { Button } from "@mindcraft-lang/ui";
import { buildWodalProgramImage } from "@mindcraft-lang/wodal";
import { useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { useMicrobitSimEnvironment } from "@/contexts/microbit-sim-environment";
import { microbitFirmwareHex, microbitFirmwareMetadata } from "@/services/firmware-asset";
import { patchFirmwareForImage } from "@/services/firmware-deploy";
import { isWebUsbSupported, microbitFlasher } from "@/services/microbit-flasher";
import { downloadHexFile } from "@/utils/file-download";
import { BrainEditor } from "./BrainEditor";
import { ConfirmDialog } from "./ConfirmDialog";
import { NameInputDialog } from "./NameInputDialog";

type BrainDialog =
  | { kind: "add" }
  | { kind: "rename"; id: string; name: string }
  | { kind: "remove"; id: string; name: string }
  | null;

/** Derives a `.hex` download filename from a brain name. */
function hexFilename(name: string): string {
  const slug = name.replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "");
  return `${slug || "brain"}.hex`;
}

/** User-managed brain list: add, select, rename, remove, and deploy brains. */
export function BrainList() {
  const store = useMicrobitSimEnvironment();
  const brains = useSyncExternalStore(store.subscribeToBrains, store.getBrains);
  const selectedId = useSyncExternalStore(store.subscribeToBrains, store.getSelectedBrainId);
  const paired = useSyncExternalStore(microbitFlasher.subscribe, microbitFlasher.isPaired);
  const [dialog, setDialog] = useState<BrainDialog>(null);
  const [editingBrainId, setEditingBrainId] = useState<string | null>(null);
  const webUsbSupported = isWebUsbSupported();

  /** Builds and patches a brain into firmware hex, toasting on failure. */
  async function buildHexForBrain(brainId: string): Promise<string | undefined> {
    const input = await store.getBuildInputForBrain(brainId);
    if (!input) {
      toast.error("Could not load brain");
      return undefined;
    }
    const built = buildWodalProgramImage(input);
    if (!built.ok) {
      toast.error(built.errors[0]?.message ?? "Build failed");
      return undefined;
    }
    const result = patchFirmwareForImage(built.image, microbitFirmwareHex, microbitFirmwareMetadata);
    if (!result.ok) {
      toast.error(
        `Program too large: needs ${result.error.requiredBytes} bytes, region holds ${result.error.regionSize}`
      );
      return undefined;
    }
    return result.hex;
  }

  async function handleConnect() {
    try {
      await microbitFlasher.pair();
      toast.success("micro:bit connected");
    } catch {
      // The user dismissed the device chooser; leave the unpaired state as-is.
    }
  }

  async function handleDownload(brainId: string, brainName: string) {
    const hex = await buildHexForBrain(brainId);
    if (hex === undefined) {
      return;
    }
    downloadHexFile(hex, hexFilename(brainName));
  }

  async function handleFlash(brainId: string) {
    const hex = await buildHexForBrain(brainId);
    if (hex === undefined) {
      return;
    }
    const toastId = toast.loading("Flashing micro:bit...");
    try {
      await microbitFlasher.flashHex(hex, (percentage) =>
        toast.loading(`Flashing micro:bit... ${Math.round(percentage)}%`, { id: toastId })
      );
      toast.success("Flashed micro:bit", { id: toastId });
    } catch (error) {
      toast.error(`Flash failed: ${error instanceof Error ? error.message : String(error)}`, { id: toastId });
    }
  }

  return (
    <section className="max-w-md">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Brains</h2>
        <div className="flex items-center gap-2">
          {webUsbSupported &&
            (paired ? (
              <span className="text-xs text-muted-foreground" data-testid="microbit-connected">
                micro:bit connected
              </span>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="connect-microbit-button"
                onClick={handleConnect}
              >
                Connect micro:bit
              </Button>
            ))}
          <Button type="button" size="sm" data-testid="add-brain-button" onClick={() => setDialog({ kind: "add" })}>
            Add brain
          </Button>
        </div>
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
                  data-testid="brain-download"
                  data-brain-name={brain.name}
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => handleDownload(brain.id, brain.name)}
                >
                  Download
                </button>
                {webUsbSupported && paired && (
                  <button
                    type="button"
                    data-testid="brain-flash"
                    data-brain-name={brain.name}
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => handleFlash(brain.id)}
                  >
                    Flash
                  </button>
                )}
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
