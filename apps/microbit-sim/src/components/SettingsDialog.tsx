import { Button, Input } from "@mindcraft-lang/ui";
import { useState } from "react";
import { useMicrobitSimEnvironment } from "@/contexts/microbit-sim-environment";
import type { AppSettings } from "@/services/microbit-sim-environment-store";
import { Modal } from "./Modal";

interface SettingsDialogProps {
  onClose: () => void;
}

/** Edits global app settings: the VS Code Bridge relay URL. */
export function SettingsDialog({ onClose }: SettingsDialogProps) {
  const store = useMicrobitSimEnvironment();
  const [draft, setDraft] = useState<AppSettings>(() => store.getAppSettings());

  const save = () => {
    store.updateAppSettings(draft);
    onClose();
  };

  return (
    <Modal title="Settings" onClose={onClose}>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="vscode-bridge-url" className="text-sm font-medium">
            VS Code Bridge URL
          </label>
          <Input
            id="vscode-bridge-url"
            value={draft.vscodeBridgeUrl}
            onChange={(e) => setDraft((prev) => ({ ...prev, vscodeBridgeUrl: e.target.value }))}
            placeholder="vscode-bridge.mindcraft-lang.org"
          />
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" size="sm" data-testid="settings-save-button" onClick={save}>
          Save
        </Button>
      </div>
    </Modal>
  );
}
