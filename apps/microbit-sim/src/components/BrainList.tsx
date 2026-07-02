import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@mindcraft-lang/ui";
import { buildWodalProgramImage } from "@mindcraft-lang/wodal";
import { MoreHorizontal, Plus, Usb } from "lucide-react";
import { useId, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { useMicrobitSimEnvironment } from "@/contexts/microbit-sim-environment";
import { microbitFirmwareHex, microbitFirmwareMetadata } from "@/services/firmware-asset";
import { patchFirmwareForImage, programJsonFromImage } from "@/services/firmware-deploy";
import { isWebUsbSupported, microbitFlasher } from "@/services/microbit-flasher";
import { downloadHexFile, downloadTextFile } from "@/utils/file-download";
import { BrainEditor } from "./BrainEditor";
import { ConfirmDialog } from "./ConfirmDialog";
import { NameInputDialog } from "./NameInputDialog";

type BrainDialog =
  | { kind: "add" }
  | { kind: "rename"; id: string; name: string }
  | { kind: "remove"; id: string; name: string }
  | null;

/** Slugifies a brain name for use as a download filename stem. */
function filenameSlug(name: string): string {
  return name.replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "") || "brain";
}

/** User-managed brain list: add, rename, remove, and deploy brains. */
export function BrainList() {
  const store = useMicrobitSimEnvironment();
  const brains = useSyncExternalStore(store.subscribeToBrains, store.getBrains);
  const paired = useSyncExternalStore(microbitFlasher.subscribe, microbitFlasher.isPaired);
  const [dialog, setDialog] = useState<BrainDialog>(null);
  const [editingBrainId, setEditingBrainId] = useState<string | null>(null);
  const headingId = useId();
  const webUsbSupported = isWebUsbSupported();

  /** Loads and builds a brain's program image, toasting on failure. */
  async function buildImageForBrain(brainId: string) {
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
    return built.image;
  }

  /** Builds and patches a brain into firmware hex, toasting on failure. */
  async function buildHexForBrain(brainId: string): Promise<string | undefined> {
    const image = await buildImageForBrain(brainId);
    if (!image) {
      return undefined;
    }
    const result = patchFirmwareForImage(image, microbitFirmwareHex, microbitFirmwareMetadata);
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
    downloadHexFile(hex, `${filenameSlug(brainName)}.hex`);
  }

  /** Downloads the brain's built program as a JSON `.mcprogram`. */
  async function handleDownloadProgram(brainId: string, brainName: string) {
    const image = await buildImageForBrain(brainId);
    if (!image) {
      return;
    }
    downloadTextFile(programJsonFromImage(image), `${filenameSlug(brainName)}.mcprogram`);
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
    <section aria-labelledby={headingId} className="max-w-md">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={headingId} className="text-base font-semibold">
          Brains
        </h2>
        <div className="flex flex-wrap items-center gap-2">
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
                <Usb />
                Connect micro:bit
              </Button>
            ))}
          <Button type="button" size="sm" data-testid="add-brain-button" onClick={() => setDialog({ kind: "add" })}>
            <Plus />
            Add brain
          </Button>
        </div>
      </div>

      {brains.length === 0 ? (
        <div className="mt-3 rounded-lg border border-dashed border-border p-6 text-center">
          <p className="text-sm text-muted-foreground">
            Brains are programs for your micro:bits. Create one to get started.
          </p>
          <Button type="button" size="sm" className="mt-3" onClick={() => setDialog({ kind: "add" })}>
            <Plus />
            Add brain
          </Button>
        </div>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {brains.map((brain) => (
            <li
              key={brain.id}
              data-testid="brain-item"
              data-brain-name={brain.name}
              className="-mx-2 flex items-center justify-between gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted/50"
            >
              <button
                type="button"
                aria-label={`Edit ${brain.name}`}
                className="min-w-0 flex-1 wrap-break-word text-left text-sm hover:underline"
                onClick={() => setEditingBrainId(brain.id)}
              >
                {brain.name}
              </button>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  data-testid="brain-edit"
                  data-brain-name={brain.name}
                  aria-label={`Edit ${brain.name}`}
                  className="rounded px-2 py-1 text-xs font-medium text-foreground hover:bg-muted"
                  onClick={() => setEditingBrainId(brain.id)}
                >
                  Edit
                </button>
                {webUsbSupported && paired && (
                  <button
                    type="button"
                    data-testid="brain-flash"
                    data-brain-name={brain.name}
                    aria-label={`Flash ${brain.name} to the connected micro:bit`}
                    className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={() => handleFlash(brain.id)}
                  >
                    Flash
                  </button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      data-testid="brain-actions"
                      data-brain-name={brain.name}
                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label={`More actions for ${brain.name}`}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      data-testid="brain-rename"
                      data-brain-name={brain.name}
                      onClick={() => setDialog({ kind: "rename", id: brain.id, name: brain.name })}
                    >
                      Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      data-testid="brain-download"
                      data-brain-name={brain.name}
                      onClick={() => handleDownload(brain.id, brain.name)}
                    >
                      Download .hex
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      data-testid="brain-download-program"
                      data-brain-name={brain.name}
                      onClick={() => handleDownloadProgram(brain.id, brain.name)}
                    >
                      Download .mcprogram
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      data-testid="brain-remove"
                      data-brain-name={brain.name}
                      className="text-destructive focus:text-destructive data-highlighted:text-destructive"
                      onClick={() => setDialog({ kind: "remove", id: brain.id, name: brain.name })}
                    >
                      Remove
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
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
