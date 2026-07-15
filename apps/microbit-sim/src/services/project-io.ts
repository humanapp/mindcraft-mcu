import {
  buildActiveProjectExportDocument,
  type ImportAppChunkResult,
  type ProjectManager,
} from "@mindcraft-lang/app-host";
import { name as appName } from "../../package.json";

/** App name microbit-sim's session chunk is keyed under in a `.mindcraft` document's manifest `app` map. */
export const MICROBIT_SIM_APP_CHUNK_KEY = appName;

/** Project app-data key holding the ordered list of brain ids. */
export const BRAINS_INDEX_KEY = "brains-index";

/** Project app-data key holding the durable simulator fleet. */
export const SIMULATOR_STATE_KEY = "simulator-state";

/** Simulator fleet payload: ordered instance ids and the brain each is flashed with. */
export interface MicrobitSimFleet {
  readonly order: readonly string[];
  readonly flash: Readonly<Record<string, string>>;
}

/** microbit-sim's session chunk inside a document manifest's `app` map: brain order and the simulator fleet. */
export interface MicrobitSimAppChunk {
  readonly brainOrder: readonly string[];
  readonly simulator: MicrobitSimFleet | undefined;
}

/** Reads microbit-sim's session chunk from a shared document, tolerating absence and malformed shapes. */
export function parseMicrobitSimAppChunk(appChunk: unknown): MicrobitSimAppChunk {
  const record = (appChunk ?? {}) as { brainOrder?: unknown; simulator?: unknown };
  const brainOrder = Array.isArray(record.brainOrder)
    ? record.brainOrder.filter((id): id is string => typeof id === "string")
    : [];

  let simulator: MicrobitSimFleet | undefined;
  const sim = record.simulator as { order?: unknown; flash?: unknown } | undefined;
  if (sim && Array.isArray(sim.order)) {
    const order = sim.order.filter((id): id is string => typeof id === "string");
    const flash: Record<string, string> = {};
    if (sim.flash && typeof sim.flash === "object") {
      for (const [id, brainId] of Object.entries(sim.flash as Record<string, unknown>)) {
        if (typeof brainId === "string") {
          flash[id] = brainId;
        }
      }
    }
    simulator = { order, flash };
  }

  return { brainOrder, simulator };
}

/** Translates microbit-sim's imported session chunk into seeded app-data. */
export function translateMicrobitSimAppChunk(appChunk: unknown): ImportAppChunkResult {
  const app = parseMicrobitSimAppChunk(appChunk);
  const appData: Record<string, string> = {};
  if (app.brainOrder.length > 0) {
    appData[BRAINS_INDEX_KEY] = JSON.stringify(app.brainOrder);
  }
  if (app.simulator) {
    appData[SIMULATOR_STATE_KEY] = JSON.stringify(app.simulator);
  }
  return { diagnostics: [], appData };
}

/**
 * Builds a shared `.mindcraft` document string for the active project: the
 * common export document with microbit-sim's session chunk embedded in the
 * manifest's `app` map. Chunks stored for other apps are preserved.
 */
export async function buildMicrobitSimExportDocument(
  projectManager: ProjectManager,
  payload: MicrobitSimAppChunk
): Promise<string> {
  const doc = await buildActiveProjectExportDocument(projectManager, {
    appChunk: { name: MICROBIT_SIM_APP_CHUNK_KEY, chunk: payload },
  });
  return JSON.stringify(doc, null, 2);
}
