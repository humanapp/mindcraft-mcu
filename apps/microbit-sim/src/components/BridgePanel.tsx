import { Switch } from "@mindcraft-lang/ui";
import { Check, Copy } from "lucide-react";
import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { useMicrobitSimEnvironment } from "@/contexts/microbit-sim-environment";
import { clearBindingToken } from "@/services/binding-token-persistence";

/**
 * VS Code Bridge controls: an enable toggle, a connection-status readout, and a
 * copyable join code. Hidden unless `AppSettings.showBridgePanel` is set. The
 * enable toggle drives the per-project `bridgeEnabled` preference; an enabled
 * bridge connects on mount and whenever the toggle flips on.
 */
export function BridgePanel() {
  const store = useMicrobitSimEnvironment();
  const appSettings = useSyncExternalStore(store.subscribeToAppSettings, store.getAppSettings);
  const bridgeStatus = useSyncExternalStore(store.subscribeToBridgeStatus, store.getBridgeStatusSnapshot);
  const joinCode = useSyncExternalStore(store.subscribeToBridgeJoinCode, store.getBridgeJoinCodeSnapshot);
  const [bridgeEnabled, setBridgeEnabled] = useState(() => store.getUiPreferences().bridgeEnabled);
  const [copied, setCopied] = useState(false);
  const headingId = useId();

  useEffect(() => {
    return store.onProjectLoaded(() => {
      setBridgeEnabled(store.getUiPreferences().bridgeEnabled);
    });
  }, [store]);

  useEffect(() => {
    if (bridgeEnabled) {
      store.connectBridge();
    }
  }, [bridgeEnabled, store]);

  if (!appSettings.showBridgePanel) {
    return null;
  }

  const statusColor =
    bridgeStatus === "connected"
      ? "text-green-600"
      : bridgeStatus === "connecting" || bridgeStatus === "reconnecting"
        ? "text-yellow-600"
        : "text-muted-foreground";

  return (
    <section
      aria-labelledby={headingId}
      className="max-w-md space-y-2 rounded-lg border border-border bg-background p-3"
    >
      <div className="flex items-center justify-between">
        <h2 id={headingId} className="text-base font-semibold">
          VS Code Bridge
        </h2>
        <Switch
          checked={bridgeEnabled}
          onCheckedChange={(checked) => {
            setBridgeEnabled(checked);
            store.updateUiPreferences({ bridgeEnabled: checked });
            if (!checked) {
              store.disconnectBridge();
              clearBindingToken();
            }
          }}
          aria-label="Toggle VS Code bridge connection"
        />
      </div>
      <output className={`text-xs font-mono ${statusColor}`}>{bridgeStatus}</output>
      {joinCode && (bridgeStatus === "connected" || bridgeStatus === "reconnecting") && (
        <div className="flex items-center gap-1.5">
          <span className="truncate font-mono text-xs text-foreground">{joinCode}</span>
          <button
            type="button"
            className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
            aria-label={copied ? "Copied to clipboard" : "Copy join code"}
            onClick={() => {
              void navigator.clipboard.writeText(joinCode);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? (
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>
        </div>
      )}
    </section>
  );
}
