import { createContext, useContext } from "react";
import type { MicrobitSimEnvironmentStore } from "@/services/microbit-sim-environment-store";

const MicrobitSimEnvironmentContext = createContext<MicrobitSimEnvironmentStore | null>(null);

export const MicrobitSimEnvironmentProvider = MicrobitSimEnvironmentContext.Provider;

/** Reads the app environment store from context. Throws when used outside the provider. */
export function useMicrobitSimEnvironment(): MicrobitSimEnvironmentStore {
  const store = useContext(MicrobitSimEnvironmentContext);
  if (!store) {
    throw new Error("useMicrobitSimEnvironment must be used within a MicrobitSimEnvironmentProvider");
  }
  return store;
}
