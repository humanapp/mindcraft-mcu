import { BrainList } from "./components/BrainList";
import { ProjectHeader } from "./components/ProjectHeader";
import { Simulator } from "./components/Simulator";

/** Root application component for the Microbit Simulator. */
export function App() {
  return (
    <div className="min-h-screen">
      <ProjectHeader />
      <main className="space-y-8 p-6">
        <BrainList />
        <Simulator />
      </main>
    </div>
  );
}
