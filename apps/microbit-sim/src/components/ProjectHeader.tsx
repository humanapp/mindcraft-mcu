import { Button } from "@mindcraft-lang/ui";
import { Download, FilePlus, FolderOpen, Settings, Upload } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { useMicrobitSimEnvironment } from "@/contexts/microbit-sim-environment";
import { downloadTextFile } from "@/utils/file-download";
import { pickFile } from "@/utils/file-upload";
import { InlineRename } from "./InlineRename";
import { NewProjectDialog } from "./NewProjectDialog";
import { ProjectPickerDialog } from "./ProjectPickerDialog";
import { SettingsDialog } from "./SettingsDialog";

type OpenDialog = "none" | "new" | "open" | "settings";

function projectFilename(name: string): string {
  const slug = name.replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "");
  return `${slug || "project"}.mindcraft`;
}

/** Top bar showing the active project with create, open, import, and export controls. */
export function ProjectHeader() {
  const store = useMicrobitSimEnvironment();
  const projectName = useSyncExternalStore(store.subscribeToActiveProject, store.getActiveProjectName);
  const [dialog, setDialog] = useState<OpenDialog>("none");

  const handleExport = async () => {
    try {
      const content = await store.exportProject();
      downloadTextFile(content, projectFilename(store.getActiveProjectName()));
    } catch {
      toast.error("Export failed");
    }
  };

  const handleImport = async () => {
    const file = await pickFile(".mindcraft,.json");
    if (!file) {
      return;
    }
    const result = await store.importProject(file);
    if (!result.success) {
      const error = result.diagnostics.find((diagnostic) => diagnostic.severity === "error");
      toast.error(error?.message ?? "Import failed");
      return;
    }
    const warnings = result.diagnostics.filter((diagnostic) => diagnostic.severity === "warning");
    if (warnings.length > 0) {
      toast.warning(`Imported with ${warnings.length} warning(s)`, {
        description: warnings.map((warning) => warning.message).join("\n"),
      });
    } else {
      toast.success("Project imported");
    }
  };

  return (
    <header className="flex flex-wrap items-center justify-between gap-y-2 border-b border-border px-4 py-3 sm:px-6">
      <div className="flex items-center gap-2">
        <h1 className="text-base font-bold">micro:bit Simulator</h1>
        <span className="text-sm text-muted-foreground">/</span>
        <InlineRename value={projectName} ariaLabel="project name" onRename={(name) => store.renameProject(name)} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" data-testid="import-project-button" onClick={handleImport}>
          <Upload />
          Import
        </Button>
        <Button type="button" variant="outline" size="sm" data-testid="export-project-button" onClick={handleExport}>
          <Download />
          Export
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="open-project-button"
          onClick={() => setDialog("open")}
        >
          <FolderOpen />
          Open
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="new-project-button"
          onClick={() => setDialog("new")}
        >
          <FilePlus />
          New project
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="settings-button"
          onClick={() => setDialog("settings")}
        >
          <Settings />
          Settings
        </Button>
      </div>
      {dialog === "new" && <NewProjectDialog onClose={() => setDialog("none")} />}
      {dialog === "open" && <ProjectPickerDialog onClose={() => setDialog("none")} />}
      {dialog === "settings" && <SettingsDialog onClose={() => setDialog("none")} />}
    </header>
  );
}
