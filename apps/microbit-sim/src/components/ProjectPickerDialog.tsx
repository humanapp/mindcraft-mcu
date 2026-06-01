import type { ProjectManifest } from "@mindcraft-lang/app-host";
import { useEffect, useState } from "react";
import { useMicrobitSimEnvironment } from "@/contexts/microbit-sim-environment";
import { Modal } from "./Modal";

interface ProjectPickerDialogProps {
  onClose: () => void;
}

/** Lists durable projects and switches to the chosen one. */
export function ProjectPickerDialog({ onClose }: ProjectPickerDialogProps) {
  const store = useMicrobitSimEnvironment();
  const [projects, setProjects] = useState<ProjectManifest[]>([]);
  const activeId = store.activeProjectManifest?.id;

  useEffect(() => {
    let active = true;
    void store.listProjects().then((list) => {
      if (active) {
        setProjects(list);
      }
    });
    return () => {
      active = false;
    };
  }, [store]);

  async function open(id: string): Promise<void> {
    if (id !== activeId) {
      await store.switchProject(id);
    }
    onClose();
  }

  return (
    <Modal title="Open project" onClose={onClose}>
      {projects.length === 0 ? (
        <p className="text-sm text-gray-500">No projects yet.</p>
      ) : (
        <ul className="max-h-72 overflow-auto">
          {projects.map((project) => (
            <li key={project.id}>
              <button
                type="button"
                data-testid="project-item"
                data-project-name={project.name}
                className="flex w-full items-center justify-between rounded px-3 py-2 text-left text-sm hover:bg-gray-100"
                onClick={() => void open(project.id)}
              >
                <span>{project.name}</span>
                {project.id === activeId && <span className="text-xs text-gray-400">current</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
