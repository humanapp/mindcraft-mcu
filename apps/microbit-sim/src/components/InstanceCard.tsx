import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@mindcraft-lang/ui";
import { MoreHorizontal, Pencil } from "lucide-react";
import { useState } from "react";
import { useMicrobitSimEnvironment } from "@/contexts/microbit-sim-environment";
import type { BrainRecord } from "@/services/microbit-sim-environment-store";
import type { FlashState, SimulatorInstance } from "@/services/simulator";
import { BrainEditor } from "./BrainEditor";
import { GesturePicker } from "./GesturePicker";
import { MicrobitDevice } from "./MicrobitDevice";

interface InstanceCardProps {
  instance: SimulatorInstance;
  label: string;
  brains: readonly BrainRecord[];
}

/**
 * One simulator instance: a brain picker that flashes the picked brain onto the
 * device, the device itself, and a Reset / Remove actions menu.
 */
export function InstanceCard({ instance, label, brains }: InstanceCardProps) {
  const store = useMicrobitSimEnvironment();
  const [editingBrain, setEditingBrain] = useState(false);
  const status = flashStatusLine(instance.flashState);
  const loaded = instance.flashState.status === "loaded";

  return (
    <div data-testid="instance-card" className="flex w-72 max-w-full flex-col gap-3 rounded-lg border p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <select
            data-testid="instance-brain-select"
            aria-label={`Brain for ${label}`}
            disabled={brains.length === 0}
            className={`w-full rounded border bg-background px-2 py-1 text-sm disabled:opacity-50 ${loaded ? "text-green-500" : "text-foreground"}`}
            value={instance.flashedBrainId ?? ""}
            onChange={(event) => {
              if (event.target.value) {
                void store.flashBrainToInstance(instance.id, event.target.value);
              }
            }}
          >
            <option value="" disabled hidden>
              no program
            </option>
            {brains.map((brain) => (
              <option key={brain.id} value={brain.id}>
                {brain.name}
              </option>
            ))}
          </select>
          {status && <output className="wrap-break-word text-xs text-destructive">{status}</output>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            data-testid="instance-edit-brain"
            aria-label={`Edit brain for ${label}`}
            disabled={!loaded}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            onClick={() => setEditingBrain(true)}
          >
            <Pencil className="h-4 w-4" />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                data-testid="instance-actions"
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label={`More actions for ${label}`}
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                data-testid="instance-reset"
                disabled={!loaded}
                onClick={() => void store.resetInstance(instance.id)}
              >
                Reset
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                data-testid="instance-remove"
                className="text-destructive focus:text-destructive data-highlighted:text-destructive"
                onClick={() => store.simulator.removeInstance(instance.id)}
              >
                Remove
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <GesturePicker instance={instance} />

      <MicrobitDevice instance={instance} />

      {editingBrain && instance.flashedBrainId && (
        <BrainEditor brainId={instance.flashedBrainId} onClose={() => setEditingBrain(false)} />
      )}
    </div>
  );
}

/** Maps a failed flash outcome to the status line shown under the brain picker. */
function flashStatusLine(flash: FlashState): string | undefined {
  if (flash.status !== "failed") {
    return undefined;
  }
  const detail = flash.errors[0]?.message;
  return detail ? `flash failed: ${detail}` : "flash failed";
}
