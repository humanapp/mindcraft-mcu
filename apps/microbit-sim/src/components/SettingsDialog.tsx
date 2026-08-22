import { Button, Input } from "@wendoo/ui";
import { useState } from "react";
import { useMicrobitSimEnvironment } from "@/contexts/microbit-sim-environment";
import { type AppSettings, DEFAULT_APP_SETTINGS } from "@/services/app-settings";
import { Modal } from "./Modal";

interface SettingsDialogProps {
  onClose: () => void;
}

/** Edits the global app settings: the VS Code Bridge relay URL and the assistant service address. */
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
            placeholder={DEFAULT_APP_SETTINGS.vscodeBridgeUrl}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="assistant-service-url" className="text-sm font-medium">
            Assistant Service URL
          </label>
          <Input
            id="assistant-service-url"
            value={draft.assistantServiceUrl}
            onChange={(e) => setDraft((prev) => ({ ...prev, assistantServiceUrl: e.target.value }))}
            placeholder={DEFAULT_APP_SETTINGS.assistantServiceUrl}
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
