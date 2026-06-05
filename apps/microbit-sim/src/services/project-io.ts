import { buildActiveProjectExportDocument, type ProjectManager } from "@mindcraft-lang/app-host";
import { buildWodalProjectTarget, WODAL_PROJECT_TARGET_KEY, type WodalDeviceProfileId } from "@mindcraft-lang/wodal";
import { name as appName } from "../../package.json";

/** Target key for microbit-sim's own project payload in a shared `.mindcraft` document. */
export const MICROBIT_SIM_TARGET_KEY = appName;

/** Project app-data key holding the ordered list of brain ids. */
export const BRAINS_INDEX_KEY = "brains-index";

/** Project app-data key holding the durable simulator fleet. */
export const SIMULATOR_STATE_KEY = "simulator-state";

/** Simulator fleet payload: ordered instance ids and the brain each is flashed with. */
export interface MicrobitSimFleet {
  readonly order: readonly string[];
  readonly flash: Readonly<Record<string, string>>;
}

/** microbit-sim's payload inside the shared document's `targets` map: brain order and the simulator fleet. */
export interface MicrobitSimTarget {
  readonly brainOrder: readonly string[];
  readonly simulator: MicrobitSimFleet | undefined;
}

/** Reads microbit-sim's target payload from a shared document, tolerating absence and malformed shapes. */
export function parseMicrobitSimTarget(appTarget: unknown): MicrobitSimTarget {
  const record = (appTarget ?? {}) as { brainOrder?: unknown; simulator?: unknown };
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

/**
 * Builds a shared `.mindcraft` document string for the active project: the common export document plus
 * the WODAL target and microbit-sim's payload. Unknown `targets` entries are preserved.
 */
export async function buildMicrobitSimExportDocument(
  projectManager: ProjectManager,
  profile: WodalDeviceProfileId,
  payload: MicrobitSimTarget
): Promise<string> {
  const doc = await buildActiveProjectExportDocument(projectManager);
  return JSON.stringify(
    {
      ...doc,
      targets: {
        ...doc.targets,
        [WODAL_PROJECT_TARGET_KEY]: buildWodalProjectTarget(profile),
        [MICROBIT_SIM_TARGET_KEY]: payload,
      },
    },
    null,
    2
  );
}
