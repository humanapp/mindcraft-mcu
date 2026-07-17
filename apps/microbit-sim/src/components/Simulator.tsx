import { Button } from "@mindcraft-lang/ui";
import { Plus } from "lucide-react";
import { useEffect, useId, useSyncExternalStore } from "react";
import { useMicrobitSimEnvironment } from "@/contexts/microbit-sim-environment";
import { InstanceCard } from "./InstanceCard";

/** The simulated micro:bit fleet: an add control and an instance grid. */
export function Simulator() {
  const store = useMicrobitSimEnvironment();
  const brains = useSyncExternalStore(store.subscribeToBrains, store.getBrains);
  const instances = useSyncExternalStore(store.simulator.subscribeToInstances, store.simulator.getInstances);
  const headingId = useId();

  useEffect(() => {
    store.simulator.start();
    return () => store.simulator.stop();
  }, [store]);

  return (
    <section aria-labelledby={headingId}>
      <div className="flex flex-wrap items-center gap-3">
        <h2 id={headingId} className="text-base font-bold">
          Simulator
        </h2>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="add-microbit-button"
          onClick={() => store.simulator.addInstance()}
        >
          <Plus />
          Add micro:bit
        </Button>
      </div>

      <div className="mt-4 flex flex-wrap gap-4">
        {instances.map((instance, index) => (
          <InstanceCard key={instance.id} instance={instance} label={`micro:bit ${index + 1}`} brains={brains} />
        ))}
      </div>
    </section>
  );
}
