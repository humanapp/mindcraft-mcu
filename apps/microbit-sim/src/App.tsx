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
      <main className="space-y-8 p-6">
        <BridgePanel />
        <BrainList />
        <Simulator />
      </main>
      <Toaster />
    </div>
  );
}
