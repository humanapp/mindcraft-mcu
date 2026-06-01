import { useMicrobitSimEnvironment } from "@/contexts/microbit-sim-environment";
import { NameInputDialog } from "./NameInputDialog";

interface NewProjectDialogProps {
  onClose: () => void;
}

/** Prompts for a name and creates a durable project. */
export function NewProjectDialog({ onClose }: NewProjectDialogProps) {
  const store = useMicrobitSimEnvironment();
  return (
    <NameInputDialog
      title="New project"
      submitLabel="Create"
      onSubmit={(name) => store.createProject(name)}
      onClose={onClose}
    />
  );
}
