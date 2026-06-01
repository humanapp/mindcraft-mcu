import type { BrainDef } from "@mindcraft-lang/core/app";
import { BrainEditorDialog, BrainEditorProvider } from "@mindcraft-lang/ui";
import { useEffect, useMemo, useState } from "react";
import { buildMicrobitBrainEditorConfig } from "@/brain/editor-config";
import { useMicrobitSimEnvironment } from "@/contexts/microbit-sim-environment";

interface BrainEditorProps {
  brainId: string;
  onClose: () => void;
}

/** Loads a brain and edits it in the Brain Editor, saving the result on submit. */
export function BrainEditor({ brainId, onClose }: BrainEditorProps) {
  const store = useMicrobitSimEnvironment();
  const config = useMemo(() => buildMicrobitBrainEditorConfig(store.env), [store]);
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
