import type { UnstableDependency } from "@mindcraft-lang/app-host";
import type { ExtensionInstallReport } from "@mindcraft-lang/bridge-app";
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
  checkMicrobitExtensionUpdates,
  installMicrobitExtension,
  installMicrobitExtensionReference,
  uninstallMicrobitExtension,
} from "@/services/microbit-extension-browser";
import { downloadTextFile } from "@/utils/file-download";
import { pickFile } from "@/utils/file-upload";
import { ConfirmDialog } from "./ConfirmDialog";
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
  const chrome = store.chrome;
  const projectName = useSyncExternalStore(store.subscribeToActiveProject, store.getActiveProjectName);
  const getExtensions = useCallback(() => store.activeProjectManifest?.extensions, [store]);
  const extensions = useSyncExternalStore(store.subscribeToActiveProject, getExtensions);
  const [dialog, setDialog] = useState<OpenDialog>("none");
  const [unstableExportDependencies, setUnstableExportDependencies] = useState<readonly UnstableDependency[] | null>(
    null
  );

  const extensionEntries = useMemo(
    () =>
      buildMicrobitExtensionEntries(
        extensions,
        microbitEmbeddedExtensions,
        store.host.installedExtensionContent,
        store.host.extensionFetchFailures
      ),
    [extensions, store]
  );

  const surfaceExtensionReport = (report: ExtensionInstallReport | undefined) => {
    if (!report) {
      return;
    }
    if (!report.committed) {
      const detail =
        report.refusal.kind === "fetch"
          ? `${report.refusal.error.code}: ${report.refusal.error.message}`
          : report.refusal.message;
      toast.error(`Could not install library. ${detail}`);
      return;
    }
    if (report.outcome.kind === "worsened") {
      const undo = report.undo;
      toast.warning("Installed with new problems", {
        description: report.outcome.newProblems
          .slice(0, 3)
          .map((problem) => `${problem.location}: ${problem.description}`)
          .join("\n"),
        ...(undo ? { action: { label: "Undo", onClick: () => void undo() } } : {}),
      });
      return;
    }
    if (report.outcome.kind === "improved") {
      toast.success(`Libraries updated; ${report.outcome.resolvedProblems.length} problem(s) resolved`);
    }
  };

  const handleInstallExtension = (coordinate: string) => {
    void (async () => {
      const result = await installMicrobitExtension(
        store.host,
        store.activeProjectManifest?.extensions,
        coordinate,
        microbitEmbeddedExtensions
      );
      if (!result.action.ok) {
        toast.error(`Could not install library (${result.action.code})`);
        return;
      }
      surfaceExtensionReport(result.report);
    })();
  };

  const handleInstallExtensionReference = (input: string) => {
    void (async () => {
      const result = await installMicrobitExtensionReference(
        store.host,
        store.activeProjectManifest?.extensions,
        input
      );
      if (!result.ok) {
        toast.error(`Could not add library. ${result.code}: ${result.message}`);
        return;
      }
      if (!result.action.ok) {
        toast.error(`Could not add library (${result.action.code})`);
        return;
      }
      if (result.report?.committed) {
        toast.success(`Installed ${result.reference}`);
      }
      surfaceExtensionReport(result.report);
    })();
  };

  const handleUninstallExtension = (coordinate: string) => {
    void (async () => {
      const result = await uninstallMicrobitExtension(
        store.host,
        store.activeProjectManifest?.extensions,
        coordinate,
        microbitEmbeddedExtensions,
        store.host.installedExtensionContent
      );
      if (!result.action.ok) {
        toast.error(`Could not remove library (${result.action.code})`);
        return;
      }
      surfaceExtensionReport(result.report);
    })();
  };

  const handleCheckUpdates = (coordinates: readonly string[]) => {
    void (async () => {
      const summary = await checkMicrobitExtensionUpdates(store.host, coordinates);
      for (const failure of summary.failures) {
        toast.error(
          `Could not check ${failure.coordinate} for updates. ${failure.error.code}: ${failure.error.message}`
        );
      }
      if (summary.updates.length === 0) {
        if (summary.failures.length === 0) {
          toast.success("Libraries are up to date");
        }
        return;
      }
      const updates = summary.updates;
      const description = updates
        .map((update) => `${update.coordinate} -> ${update.latestVersion ?? update.resolvedSha?.slice(0, 12) ?? ""}`)
        .join("\n");
      toast.info(`${updates.length} update(s) available`, {
        description,
        action: {
          label: updates.length > 1 ? "Update all" : "Update",
          onClick: () => {
            void (async () => {
              surfaceExtensionReport(await store.host.applyExtensionUpdates(updates));
            })();
          },
        },
      });
    })();
  };

  const handleCheckAllUpdates = () => {
    handleCheckUpdates(extensionEntries.filter((entry) => entry.updatable === true).map((entry) => entry.coordinate));
  };

  const handleRetryExtension = () => {
    void (async () => {
      surfaceExtensionReport(await store.host.updateProjectExtensions(store.activeProjectManifest?.extensions ?? {}));
    })();
  };

  const performExport = async () => {
    try {
      const content = await store.exportProject();
      downloadTextFile(content, projectFilename(store.getActiveProjectName()));
    } catch {
      toast.error("Export failed");
    }
  };

  const handleExport = async () => {
    const unstable = await store.host.collectUnstableProjectDependencies();
    if (unstable.length > 0) {
      setUnstableExportDependencies(unstable);
      return;
    }
    await performExport();
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
          {chrome.showProjectMenu && (
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
                  Libraries...
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {chrome.showExtensionsButton && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="host-extensions-button"
              onClick={() => setDialog("extensions")}
            >
              <Blocks />
              Libraries
            </Button>
          )}
          {chrome.showSettings && (
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
          )}
        </div>
      </div>
      {dialog === "new" && <NewProjectDialog onClose={() => setDialog("none")} />}
      {dialog === "open" && <ProjectPickerDialog onClose={() => setDialog("none")} />}
      {dialog === "settings" && <SettingsDialog onClose={() => setDialog("none")} />}
      {unstableExportDependencies !== null && (
        <ConfirmDialog
          title="Export with unstable dependencies?"
          message={
            "This project depends on libraries that are not stable for consumers: " +
            `${unstableExportDependencies
              .map((dependency) => `${dependency.coordinate} (${dependency.code})`)
              .join(", ")}. ` +
            "The exported project may not work, or may not keep working, for anyone else."
          }
          confirmLabel="Export anyway"
          onConfirm={performExport}
          onClose={() => setUnstableExportDependencies(null)}
        />
      )}
      <ExtensionBrowserDialog
        open={dialog === "extensions"}
        onOpenChange={(open) => setDialog(open ? "extensions" : "none")}
        entries={extensionEntries}
        onInstall={handleInstallExtension}
        onUninstall={handleUninstallExtension}
        onCheckUpdate={(coordinate) => handleCheckUpdates([coordinate])}
        onRetry={handleRetryExtension}
        onCheckAllUpdates={handleCheckAllUpdates}
        onInstallReference={handleInstallExtensionReference}
      />
    </header>
  );
}
