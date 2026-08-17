import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { loadAnalytics } from "./analytics";
import { MicrobitSimEnvironmentProvider } from "./contexts/microbit-sim-environment";
import { DocsPage } from "./DocsPage";
import { MicrobitSimEnvironmentStore } from "./services/microbit-sim-environment-store";
import "./globals.css";

// Backstop for otherwise-silent floated promise rejections (e.g. an async build
// or flash path that throws off the awaited chain). The per-brain diagnostic
// channels are the primary surface; this ensures nothing fails invisibly.
window.addEventListener("unhandledrejection", (event) => {
  console.error("Unhandled promise rejection", event.reason);
});

loadAnalytics();

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element not found");
}

async function bootstrap(mount: HTMLElement): Promise<void> {
  let disposed = false;
  const store = await MicrobitSimEnvironmentStore.create();
  const disposeStore = () => {
    if (disposed) {
      return;
    }
    disposed = true;
    store.dispose();
  };
  window.addEventListener("pagehide", disposeStore, { once: true });
  // Going hidden commits the pending project save; the store stays alive.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      void store.projectManager.flushAutoSave();
    }
  });

  await store.initialize();
  createRoot(mount).render(
    <StrictMode>
      <MicrobitSimEnvironmentProvider value={store}>
        {window.location.pathname.startsWith("/docs") ? <DocsPage /> : <App />}
      </MicrobitSimEnvironmentProvider>
    </StrictMode>
  );
}

void bootstrap(root);
