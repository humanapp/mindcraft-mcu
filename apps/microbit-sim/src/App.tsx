import { Toaster } from "sonner";
import { BrainList } from "./components/BrainList";
import { BridgePanel } from "./components/BridgePanel";
import { ProjectHeader } from "./components/ProjectHeader";
import { Simulator } from "./components/Simulator";

/** Root application component for the Microbit Simulator. */
export function App() {
  return (
    <div className="min-h-screen">
      <ProjectHeader />
      <main className="p-6">
        <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-2">
          <div className="space-y-8">
            <BridgePanel />
            <BrainList />
          </div>
          <Simulator />
        </div>
      </main>
      <Toaster />
    </div>
  );
}
