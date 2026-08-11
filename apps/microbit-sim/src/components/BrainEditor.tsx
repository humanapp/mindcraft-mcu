import { useAssistant } from "@mindcraft-lang/assistant-panel";
import type { BrainDef } from "@mindcraft-lang/core/app";
import { useDocsSidebar } from "@mindcraft-lang/docs";
import { BrainEditorDialog, BrainEditorProvider } from "@mindcraft-lang/ui";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { buildMicrobitBrainEditorConfig } from "@/brain/editor-config";
import { useMicrobitSimEnvironment } from "@/contexts/microbit-sim-environment";
import { AssistantSidePanel } from "./AssistantSidePanel";

interface BrainEditorProps {
  brainId: string;
  onClose: () => void;
}

/** Name to present the brain by while the editor stands no working copy of it. */
const kUnopenedBrainName = "Brain";

/** Loads a brain and edits it in the Brain Editor, saving the result on submit. */
export function BrainEditor({ brainId, onClose }: BrainEditorProps) {
  const store = useMicrobitSimEnvironment();
  const { stopAll } = useAssistant();
  // Rebuild the editor config when user tiles install so the palette picks up newly compiled tiles,
  // and when the VFS revision advances so tile icons re-resolve against the new asset generation.
  const docRevision = useSyncExternalStore(store.subscribeToDocRevision, store.getDocRevisionSnapshot);
  const vfsRevision = useSyncExternalStore(store.subscribeToVfsRevision, store.getVfsRevisionSnapshot);
  // Rebuild the config (and thus the isBrokenTile predicate identity) after each
  // workspace compile so broken-tile badges appear/disappear as tiles change
  // their compile status while the editor is open.
  const compileDiagnostics = useSyncExternalStore(
    store.subscribeToCompileDiagnostics,
    store.getCompileDiagnosticsSnapshot
  );
  const {
    openDocsForTile,
    isOpen: isDocsOpen,
    toggle: toggleDocs,
    close: closeDocs,
    reportEditorMode,
  } = useDocsSidebar();
  const [srcBrainDef, setSrcBrainDef] = useState<BrainDef | undefined>(undefined);
  const [isOpen, setIsOpen] = useState(false);
  // Whether the assistant panel stands open for the brain being edited. The
  // store holds the answer per brain for as long as the app runs.
  const [isAssistantOpen, setIsAssistantOpen] = useState(() => store.isAssistantPanelOpen(brainId));
  const isAssistantOpenRef = useRef(isAssistantOpen);
  isAssistantOpenRef.current = isAssistantOpen;

  useEffect(() => {
    setIsAssistantOpen(store.isAssistantPanelOpen(brainId));
  }, [brainId, store]);

  const toggleAssistant = useCallback(() => {
    const next = !isAssistantOpenRef.current;
    setIsAssistantOpen(next);
    store.setAssistantPanelOpen(brainId, next);
  }, [brainId, store]);
  const entityName = srcBrainDef?.name() ?? kUnopenedBrainName;
  const workspaces = store.assistant.workspaces;
  const config = useMemo(() => {
    void docRevision;
    void vfsRevision;
    void compileDiagnostics;
    return buildMicrobitBrainEditorConfig({
      env: store.env,
      resolveVfsAssetUrl: (url) => store.resolveVfsAssetUrl(url),
      projectNamespace: store.activeProjectManifest?.id,
      onTileDocs: openDocsForTile,
      docsIntegration: { isOpen: isDocsOpen, toggle: toggleDocs, close: closeDocs, reportMode: reportEditorMode },
      sidePanel: {
        isOpen: isAssistantOpen,
        toggle: toggleAssistant,
        label: entityName,
        content: <AssistantSidePanel isOpen={isAssistantOpen} fallbackName={entityName} workspaces={workspaces} />,
      },
      libraries: store.host.installedLibraries,
      printTransport: store.printTransport,
      isBrokenTile: (tile) => store.host.getTileCompileDiagnostics(tile.action.key) !== undefined,
    });
  }, [
    store,
    docRevision,
    vfsRevision,
    compileDiagnostics,
    openDocsForTile,
    isDocsOpen,
    toggleDocs,
    closeDocs,
    reportEditorMode,
    isAssistantOpen,
    toggleAssistant,
    entityName,
    workspaces,
  ]);

  useEffect(() => {
    let active = true;
    void store.getBrain(brainId).then((brainDef) => {
      if (active) {
        setSrcBrainDef(brainDef);
        setIsOpen(true);
      }
    });
    return () => {
      active = false;
    };
  }, [store, brainId]);

  return (
    <BrainEditorProvider config={config}>
      <BrainEditorDialog
        isOpen={isOpen}
        onOpenChange={(open) => {
          setIsOpen(open);
          if (!open) {
            stopAll();
            onClose();
          }
        }}
        srcBrainDef={srcBrainDef}
        onSubmit={(newBrainDef) => {
          stopAll();
          void store.saveBrain(brainId, newBrainDef);
          onClose();
        }}
      />
    </BrainEditorProvider>
  );
}
