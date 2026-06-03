import { Button } from "@mindcraft-lang/ui";
import { useEffect, useSyncExternalStore } from "react";
import { useMicrobitSimEnvironment } from "@/contexts/microbit-sim-environment";
import { InstanceCard } from "./InstanceCard";

/** The simulated microbit fleet: an editor-brain selector, an add control, and an instance grid. */
export function Simulator() {
  const store = useMicrobitSimEnvironment();
  const brains = useSyncExternalStore(store.subscribeToBrains, store.getBrains);
  const selectedBrainId = useSyncExternalStore(store.subscribeToBrains, store.getSelectedBrainId);
  const instances = useSyncExternalStore(store.simulator.subscribeToInstances, store.simulator.getInstances);

  useEffect(() => {
    store.simulator.start();
    return () => store.simulator.stop();
  }, [store]);

  return (
    <section>
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-semibold">Simulator</h2>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          Brain
          <select
            data-testid="sim-brain-select"
            className="rounded border bg-background px-2 py-1 text-sm text-foreground"
            value={selectedBrainId ?? ""}
            onChange={(event) => store.selectBrain(event.target.value)}
          >
            {brains.length === 0 && <option value="">No brains</option>}
            {brains.map((brain) => (
              <option key={brain.id} value={brain.id}>
                {brain.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex-1" />
        <Button type="button" size="sm" data-testid="add-microbit-button" onClick={() => store.simulator.addInstance()}>
          + Add microbit
        </Button>
      </div>

      <div className="mt-4 flex flex-wrap gap-4">
        {instances.map((instance, index) => (
          <InstanceCard key={instance.id} instance={instance} label={`microbit ${index + 1}`} brains={brains} />
        ))}
      </div>
    </section>
  );
}
