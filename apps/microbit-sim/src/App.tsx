import { Toaster } from "sonner";
import { BrainList } from "./components/BrainList";
import { BridgePanel } from "./components/BridgePanel";
import { ProjectHeader } from "./components/ProjectHeader";
import { Simulator } from "./components/Simulator";
import { useMicrobitSimEnvironment } from "./contexts/microbit-sim-environment";

/** Root application component for the micro:bit Simulator. */
export function App() {
  const store = useMicrobitSimEnvironment();
  const chrome = store.chrome;
  return (
    <div className="min-h-screen">
      <ProjectHeader />
      <main className="p-4 sm:p-6">
        <div className="mx-auto grid w-full max-w-7xl grid-cols-1 items-start gap-8 lg:grid-cols-2">
          {/* On a single column the wrapper dissolves (display: contents), making all three
              sections grid items so the bridge panel can order below the simulator. */}
          <div className="contents lg:block lg:space-y-8">
            <BrainList />
            {chrome.showBridgePanel && (
              <div className="order-last">
                <BridgePanel />
              </div>
            )}
          </div>
          <Simulator />
        </div>
      </main>
      <Toaster />
    </div>
  );
}
