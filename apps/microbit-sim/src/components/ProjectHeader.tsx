import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  ExtensionBrowserDialog,
} from "@mindcraft-lang/ui";
import { Blocks, ChevronDown, Download, FilePlus, FolderOpen, Settings, Upload } from "lucide-react";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { useMicrobitSimEnvironment } from "@/contexts/microbit-sim-environment";
import { microbitEmbeddedExtensions } from "@/services/microbit-embedded-extensions";
import {
  buildMicrobitExtensionEntries,
  installMicrobitExtension,
  uninstallMicrobitExtension,
} from "@/services/microbit-extension-browser";
import { downloadTextFile } from "@/utils/file-download";
import { pickFile } from "@/utils/file-upload";
import { InlineRename } from "./InlineRename";
import { NewProjectDialog } from "./NewProjectDialog";
import { ProjectPickerDialog } from "./ProjectPickerDialog";
import { SettingsDialog } from "./SettingsDialog";

type OpenDialog = "none" | "new" | "open" | "settings" | "extensions";

function projectFilename(name: string): string {
  const slug = name.replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "");
  return `${slug || "project"}.mindcraft`;
}

/** Top bar showing the active project with create, open, import, and export controls. */
export function ProjectHeader() {
  const store = useMicrobitSimEnvironment();
  const projectName = useSyncExternalStore(store.subscribeToActiveProject, store.getActiveProjectName);
  const getExtensions = useCallback(() => store.activeProjectManifest?.extensions, [store]);
  const extensions = useSyncExternalStore(store.subscribeToActiveProject, getExtensions);
  const [dialog, setDialog] = useState<OpenDialog>("none");

  const extensionEntries = useMemo(
    () => buildMicrobitExtensionEntries(extensions, microbitEmbeddedExtensions),
    [extensions]
  );

  const handleInstallExtension = (coordinate: string) => {
    void (async () => {
      const result = await installMicrobitExtension(
        store.host,
        store.activeProjectManifest?.extensions,
        coordinate,
        microbitEmbeddedExtensions
      );
      if (!result.ok) {
        toast.error(`Could not install extension (${result.code})`);
      }
    })();
  };

  const handleUninstallExtension = (coordinate: string) => {
    void (async () => {
      const result = await uninstallMicrobitExtension(
        store.host,
        store.activeProjectManifest?.extensions,
        coordinate,
        microbitEmbeddedExtensions
      );
      if (!result.ok) {
        toast.error(`Could not remove extension (${result.code})`);
      }
    })();
  };

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
    <header className="border-b border-border px-4 py-3 sm:px-6">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-y-2">
        <div className="flex items-center gap-2">
          <h1 className="text-base font-bold">micro:bit Simulator</h1>
          <span className="text-sm text-muted-foreground">/</span>
          <InlineRename value={projectName} ariaLabel="project name" onRename={(name) => store.renameProject(name)} />
        </div>
        <div className="flex flex-wrap gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="sm" data-testid="project-menu-button">
                Project
                <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem data-testid="new-project-button" onClick={() => setDialog("new")}>
                <FilePlus />
                New project...
              </DropdownMenuItem>
              <DropdownMenuItem data-testid="open-project-button" onClick={() => setDialog("open")}>
                <FolderOpen />
                Open...
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem data-testid="import-project-button" onClick={() => void handleImport()}>
                <Upload />
                Import...
              </DropdownMenuItem>
              <DropdownMenuItem data-testid="export-project-button" onClick={() => void handleExport()}>
                <Download />
                Export
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem data-testid="extensions-button" onClick={() => setDialog("extensions")}>
                <Blocks />
                Extensions...
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="settings-button"
            aria-label="Settings"
            title="Settings"
            onClick={() => setDialog("settings")}
          >
            <Settings />
          </Button>
        </div>
      </div>
      {dialog === "new" && <NewProjectDialog onClose={() => setDialog("none")} />}
      {dialog === "open" && <ProjectPickerDialog onClose={() => setDialog("none")} />}
      {dialog === "settings" && <SettingsDialog onClose={() => setDialog("none")} />}
      <ExtensionBrowserDialog
        open={dialog === "extensions"}
        onOpenChange={(open) => setDialog(open ? "extensions" : "none")}
        entries={extensionEntries}
        onInstall={handleInstallExtension}
        onUninstall={handleUninstallExtension}
      />
    </header>
  );
}
