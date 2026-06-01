import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { MicrobitSimEnvironmentProvider } from "./contexts/microbit-sim-environment";
import { MicrobitSimEnvironmentStore } from "./services/microbit-sim-environment-store";
import "./globals.css";

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
        <App />
      </MicrobitSimEnvironmentProvider>
    </StrictMode>
  );
}

void bootstrap(root);
