import { BrainList } from "./components/BrainList";
import { ProjectHeader } from "./components/ProjectHeader";

/** Root application component for the Microbit Simulator. */
export function App() {
  return (
    <div className="min-h-screen">
      <ProjectHeader />
      <main className="p-6">
        <BrainList />
      </main>
    </div>
  );
}
