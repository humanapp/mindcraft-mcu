import type { ScenarioInput, ScenarioInputKind } from "@mindcraft-lang/assistant-bridge";
import type { RehearsalWorld, WorldStaging } from "@mindcraft-lang/assistant-bridge/kit";
import { buildWodalProgramImage } from "../../../mindcraft/build-kernel";
import { getWodalDeviceProfile, WodalDeviceProfileId } from "../../../mindcraft/device-profile";
import { MicroBit } from "../microbit";
import { getMicroBitContextDevice } from "../mindcraft/context";
import { WodalMicroBitRuntime } from "../mindcraft/runtime";

/** Simulated milliseconds one think advances the device. */
const THINK_STEP_MS = 16;

/** One percept channel of the device: what a level of it means, and how a level reaches the device. */
interface Percept {
  /** One plain sentence stating what a scripted level means and the range it is read over. */
  readonly description: string;
  /** Applies one scripted level to a device through its own host-input seam. */
  apply(device: MicroBit, value: number | boolean): void;
}

/**
 * The percept channels a scenario may script, keyed by the input kind that
 * names each. A level applied by one entry holds until a later entry of the
 * same kind changes it.
 */
const PERCEPTS: Readonly<Record<string, Percept>> = {
  "button-a": {
    description: "Whether the A button is held down: true presses it, false releases it.",
    apply: (device, value) => device.setButtonPressed("A", Boolean(value)),
  },
  "button-b": {
    description: "Whether the B button is held down: true presses it, false releases it.",
    apply: (device, value) => device.setButtonPressed("B", Boolean(value)),
  },
  "logo-touch": {
    description: "Whether the touch logo is being touched: true holds the touch, false lets go.",
    apply: (device, value) => device.setLogoTouched(Boolean(value)),
  },
  "light-level": {
    description: "How bright the room is, from 0 (dark) to 255 (bright); a level outside that range is clamped.",
    apply: (device, value) => device.setLightLevel(Number(value)),
  },
};

/** Every percept kind a scenario may script for this target, sorted by name. */
export const PERCEPT_KINDS: readonly ScenarioInputKind[] = Object.entries(PERCEPTS)
  .map(([name, percept]) => ({ name, description: percept.description }))
  .sort((a, b) => (a.name < b.name ? -1 : 1));

/**
 * One device running the brain under study, stepped at a fixed simulated
 * timestep, with the scenario's percepts applied before the think they name.
 */
class DeviceWorld implements RehearsalWorld {
  /** Zero-based index of the think the next {@link step} runs. */
  private think = 0;

  constructor(
    private readonly device: MicroBit,
    private readonly runtime: WodalMicroBitRuntime,
    private readonly inputs: readonly ScenarioInput[]
  ) {}

  step(): void {
    for (const input of this.inputs) {
      if (input.at === this.think) {
        PERCEPTS[input.kind].apply(this.device, input.value);
      }
    }
    this.runtime.tick(THINK_STEP_MS);
    this.think++;
  }

  /** True: the device is in the world from the first think and never leaves it. */
  subjectPresent(): boolean {
    return true;
  }

  participants(): number {
    return 1;
  }

  brainsExecuted(): number {
    return 1;
  }

  shutdown(): void {
    this.runtime.unload();
  }
}

/**
 * Stage one device world: build the brain under study into a program image for
 * the device profile, load it onto a fresh device, and report the loaded brain
 * as the participant under study. Throws when the brain does not build, the
 * device refuses the image, or the load publishes no event stream.
 */
export function createDeviceWorld(staging: WorldStaging): RehearsalWorld {
  const built = buildWodalProgramImage({
    brainDef: staging.subjectBrain,
    environment: staging.environment,
    deviceProfile: getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2),
  });
  if (!built.ok) {
    throw new Error(`the brain under study did not build: ${built.errors.map((error) => error.code).join(", ")}`);
  }

  const device = new MicroBit();
  const runtime = new WodalMicroBitRuntime({ environment: staging.environment, microbit: device });
  const loaded = runtime.loadWodalProgramImage(built.image);
  if (!loaded.ok) {
    throw new Error(`the device refused the program image: ${loaded.errors.map((error) => error.code).join(", ")}`);
  }

  const events = runtime.brainEvents();
  if (events === undefined) {
    throw new Error("the device published no brain event stream after loading the program image");
  }
  staging.observeSubject({
    brain: { events: () => events },
    runs: (ctx) => getMicroBitContextDevice(ctx) === device,
  });

  return new DeviceWorld(device, runtime, staging.inputs);
}
