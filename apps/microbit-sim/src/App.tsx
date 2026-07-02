import { Toaster } from "sonner";
import { BrainList } from "./components/BrainList";
import { BridgePanel } from "./components/BridgePanel";
import { ProjectHeader } from "./components/ProjectHeader";
import { Simulator } from "./components/Simulator";

/** Root application component for the micro:bit Simulator. */
export function App() {
  return (
    <div className="min-h-screen">
      <ProjectHeader />
      <main className="p-4 sm:p-6">
        <div className="mx-auto grid w-full max-w-7xl grid-cols-1 items-start gap-8 lg:grid-cols-2">
          <div className="space-y-8">
            <BrainList />
            <BridgePanel />
          </div>
          <Simulator />
        </div>
      </main>
      <Toaster />
    </div>
  );
}
