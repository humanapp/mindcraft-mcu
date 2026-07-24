import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
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

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element not found");
}

async function bootstrap(mount: HTMLElement): Promise<void> {
  const store = await MicrobitSimEnvironmentStore.create();
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
