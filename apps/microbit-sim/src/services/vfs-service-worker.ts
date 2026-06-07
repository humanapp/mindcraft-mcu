import { registerVfsServiceWorker } from "@mindcraft-lang/bridge-app";
import type { MicrobitSimEnvironmentStore } from "./microbit-sim-environment-store";

/**
 * Registers the VFS service worker for the active project and keeps the store's
 * VFS revision in sync. Bumps the revision when the worker takes control, on
 * local filesystem changes, and on each project load (re-subscribing to the new
 * project's filesystem).
 */
export function initVfsServiceWorker(store: MicrobitSimEnvironmentStore): void {
  const swUrl = import.meta.env.DEV ? "/src/vfs-sw-entry.ts" : "/vfs-service-worker.js";
  registerVfsServiceWorker({
    swUrl,
    getProjectFileSystem: () => store.projectFileSystem,
    onReady: () => store.bumpVfsRevision(),
  });

  let unsubLocalChange = store.projectFileSystem.onLocalChange(() => store.bumpVfsRevision());
  store.onProjectLoaded(() => {
    unsubLocalChange();
    unsubLocalChange = store.projectFileSystem.onLocalChange(() => store.bumpVfsRevision());
    store.bumpVfsRevision();
  });
}
