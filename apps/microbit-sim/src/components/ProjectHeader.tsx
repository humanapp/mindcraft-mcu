import { Button } from "@mindcraft-lang/ui";
import { useState, useSyncExternalStore } from "react";
import { useMicrobitSimEnvironment } from "@/contexts/microbit-sim-environment";
import { InlineRename } from "./InlineRename";
import { NewProjectDialog } from "./NewProjectDialog";
import { ProjectPickerDialog } from "./ProjectPickerDialog";

type OpenDialog = "none" | "new" | "open";

/** Top bar showing the active project with create and open controls. */
export function ProjectHeader() {
  const store = useMicrobitSimEnvironment();
  const projectName = useSyncExternalStore(store.subscribeToActiveProject, store.getActiveProjectName);
  const [dialog, setDialog] = useState<OpenDialog>("none");

  return (
    <header className="flex items-center justify-between border-b border-border px-6 py-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold">Microbit Simulator</span>
        <span className="text-sm text-muted-foreground">/</span>
        <InlineRename value={projectName} ariaLabel="project name" onRename={(name) => store.renameProject(name)} />
      </div>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="open-project-button"
          onClick={() => setDialog("open")}
        >
          Open
        </Button>
        <Button type="button" size="sm" data-testid="new-project-button" onClick={() => setDialog("new")}>
          New project
        </Button>
      </div>
      {dialog === "new" && <NewProjectDialog onClose={() => setDialog("none")} />}
      {dialog === "open" && <ProjectPickerDialog onClose={() => setDialog("none")} />}
    </header>
  );
}
