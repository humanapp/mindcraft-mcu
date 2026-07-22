import type { BrainDef } from "@mindcraft-lang/core/app";
import { useDocsSidebar } from "@mindcraft-lang/docs";
import { BrainEditorDialog, BrainEditorProvider } from "@mindcraft-lang/ui";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { buildMicrobitBrainEditorConfig } from "@/brain/editor-config";
import { useMicrobitSimEnvironment } from "@/contexts/microbit-sim-environment";

interface BrainEditorProps {
  brainId: string;
  onClose: () => void;
}

/** Loads a brain and edits it in the Brain Editor, saving the result on submit. */
export function BrainEditor({ brainId, onClose }: BrainEditorProps) {
  const store = useMicrobitSimEnvironment();
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
  const { openDocsForTile, isOpen: isDocsOpen, toggle: toggleDocs, close: closeDocs } = useDocsSidebar();
  const config = useMemo(() => {
    void docRevision;
    void vfsRevision;
    void compileDiagnostics;
    return buildMicrobitBrainEditorConfig(
      store.env,
      (url) => store.resolveVfsAssetUrl(url),
      store.activeProjectManifest?.id,
      openDocsForTile,
      { isOpen: isDocsOpen, toggle: toggleDocs, close: closeDocs },
      store.host.installedLibraries,
      store.printTransport,
      (tile) => store.host.getTileCompileDiagnostics(tile.action.key) !== undefined
    );
  }, [store, docRevision, vfsRevision, compileDiagnostics, openDocsForTile, isDocsOpen, toggleDocs, closeDocs]);
  const [srcBrainDef, setSrcBrainDef] = useState<BrainDef | undefined>(undefined);
  const [isOpen, setIsOpen] = useState(false);

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
            onClose();
          }
        }}
        srcBrainDef={srcBrainDef}
        onSubmit={(newBrainDef) => {
          void store.saveBrain(brainId, newBrainDef);
          onClose();
        }}
      />
    </BrainEditorProvider>
  );
}
