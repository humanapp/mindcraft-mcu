import { Button } from "@mindcraft-lang/ui";
import { useMicrobitSimEnvironment } from "@/contexts/microbit-sim-environment";
import type { BrainRecord } from "@/services/microbit-sim-environment-store";
import type { SimulatorInstance } from "@/services/simulator";
import { MicrobitDevice } from "./MicrobitDevice";

interface InstanceCardProps {
  instance: SimulatorInstance;
  label: string;
  brains: readonly BrainRecord[];
}

/** One simulator instance: its program title, the device, and a Flash / Remove toolbar. */
export function InstanceCard({ instance, label, brains }: InstanceCardProps) {
  const store = useMicrobitSimEnvironment();
  const title = programTitle(instance, brains);

  return (
    <div data-testid="instance-card" className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-col">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className={`text-sm font-semibold ${title.className}`}>{title.text}</span>
        {title.detail && <span className="text-xs text-destructive">{title.detail}</span>}
      </div>

      <MicrobitDevice instance={instance} />

      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          className="flex-1"
          data-testid="flash-button"
          onClick={() => void store.flashInstance(instance.id)}
        >
          Flash
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="flex-1"
          data-testid="remove-instance-button"
          onClick={() => store.simulator.removeInstance(instance.id)}
        >
          Remove
        </Button>
      </div>
    </div>
  );
}

/** Resolves the flash state into the program-name title shown above the board. */
function programTitle(
  instance: SimulatorInstance,
  brains: readonly BrainRecord[]
): { text: string; className: string; detail?: string } {
  const flash = instance.flashState;
  switch (flash.status) {
    case "loaded": {
      const name = brains.find((brain) => brain.id === flash.brainId)?.name ?? flash.brainId;
      return { text: name, className: "text-green-500" };
    }
    case "failed":
      return { text: "flash failed", className: "text-destructive", detail: flash.errors[0]?.message };
    case "noBrainSelected":
      return { text: "no brain selected", className: "text-amber-500" };
    default:
      return { text: "no program", className: "text-muted-foreground" };
  }
}
