import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BrainDef,
  coreModule,
  createMindcraftEnvironment,
  type MindcraftEnvironment,
  mkActuatorTileId,
  mkSensorTileId,
} from "@mindcraft-lang/core/app";
import {
  buildWodalProgramImage,
  getWodalDeviceProfile,
  type WodalBuildInput,
  WodalDeviceProfileId,
} from "@mindcraft-lang/wodal";
import { createMicroBitV2Module, WodalMicroBitV2ActionId } from "@mindcraft-lang/wodal/targets/microbit-v2";
import { MicrobitSimulator } from "./simulator";

function microbitEnvironment(): MindcraftEnvironment {
  return createMindcraftEnvironment({ modules: [coreModule(), createMicroBitV2Module()] });
}

/** Builds a minimal, API-generated program image so a loaded instance has something to tick. */
function buildMinimalImage(env: MindcraftEnvironment) {
  const brainDef = env.withServices((services) => BrainDef.emptyBrainDef(services, "test brain"));
  const built = buildWodalProgramImage({
    brainDef,
    environment: env,
    deviceProfile: getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2),
  });
  if (!built.ok) {
    assert.fail("expected a successful build");
  }
  return built.image;
}

/** Builds the button-A -> set-pixel brain as a WODAL build input, through the tile API. */
function buttonDisplayInput(env: MindcraftEnvironment): WodalBuildInput {
  const services = env.brainServices;
  const sensorTile = services.edit.tiles.get(mkSensorTileId(WodalMicroBitV2ActionId.ButtonA))!;
  const actuatorTile = services.edit.tiles.get(mkActuatorTileId(WodalMicroBitV2ActionId.DisplaySetPixel))!;
  const brainDef = BrainDef.emptyBrainDef(services, "button display");
  const rule = brainDef.pages().get(0)!.children().get(0)!;
  rule.when().appendTile(sensorTile);
  rule.do().appendTile(actuatorTile);
  return { brainDef, environment: env, deviceProfile: getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2) };
}

describe("MicrobitSimulator instance lifecycle", () => {
  it("starts with one instance registered in the shared medium", () => {
    const sim = new MicrobitSimulator(microbitEnvironment());
    assert.equal(sim.getInstances().length, 1);
    assert.equal(sim.sharedMedium().has(sim.getInstances()[0]!.id), true);
    assert.equal(sim.sharedMedium().size(), 1);
  });

  it("add and remove update the list and medium registration", () => {
    const sim = new MicrobitSimulator(microbitEnvironment());
    const first = sim.getInstances()[0]!;
    const second = sim.addInstance();

    assert.equal(sim.getInstances().length, 2);
    assert.equal(sim.sharedMedium().has(second.id), true);

    sim.removeInstance(second.id);
    assert.equal(sim.getInstances().length, 1);
    assert.equal(sim.sharedMedium().has(second.id), false);
    assert.equal(sim.sharedMedium().has(first.id), true);
    assert.equal(sim.sharedMedium().size(), 1);
  });

  it("notifies instance-list subscribers on add and remove", () => {
    const sim = new MicrobitSimulator(microbitEnvironment());
    let notifications = 0;
    const unsubscribe = sim.subscribeToInstances(() => {
      notifications++;
    });
    const created = sim.addInstance();
    sim.removeInstance(created.id);
    unsubscribe();
    assert.equal(notifications, 2);
  });

  it("setInstances rebuilds the fleet with the given ids and re-registers the medium", () => {
    const sim = new MicrobitSimulator(microbitEnvironment());
    const original = sim.getInstances()[0]!;

    const fleet = sim.setInstances(["a", "b", "c"]);

    assert.equal(sim.getInstances().length, 3);
    assert.deepEqual(
      fleet.map((instance) => instance.id),
      ["a", "b", "c"]
    );
    assert.equal(sim.sharedMedium().has(original.id), false);
    assert.equal(sim.sharedMedium().size(), 3);
    for (const id of ["a", "b", "c"]) {
      assert.equal(sim.sharedMedium().has(id), true);
    }
  });

  it("setInstances to an empty list leaves an empty fleet", () => {
    const sim = new MicrobitSimulator(microbitEnvironment());
    sim.setInstances([]);
    assert.equal(sim.getInstances().length, 0);
    assert.equal(sim.sharedMedium().size(), 0);
  });
});

describe("MicrobitSimulator tick driver", () => {
  it("ticks the list with unloaded instances without throwing or advancing their time", () => {
    const sim = new MicrobitSimulator(microbitEnvironment());
    sim.addInstance();
    sim.tick(16);
    for (const instance of sim.getInstances()) {
      assert.equal(instance.snapshot().time, 0);
    }
  });

  it("advances each loaded instance's time independently with no cross-instance leakage", () => {
    const env = microbitEnvironment();
    const sim = new MicrobitSimulator(env);
    const a = sim.getInstances()[0]!;
    const b = sim.addInstance();

    assert.deepEqual(a.runtime.loadWodalProgramImage(buildMinimalImage(env)), { ok: true });
    assert.deepEqual(b.runtime.loadWodalProgramImage(buildMinimalImage(env)), { ok: true });

    a.tick(16);
    assert.equal(a.snapshot().time, 16);
    assert.equal(b.snapshot().time, 0);

    b.tick(32);
    assert.equal(b.snapshot().time, 32);
    assert.equal(a.snapshot().time, 16);
  });
});

describe("MicrobitSimulator flash", () => {
  it("flashes the selected brain onto an instance and runs it", () => {
    const env = microbitEnvironment();
    const sim = new MicrobitSimulator(env);
    const instance = sim.getInstances()[0]!;

    sim.flash(instance.id, buttonDisplayInput(env), "brain-1");

    assert.deepEqual(instance.flashState, { status: "loaded", brainId: "brain-1" });
    assert.equal(instance.flashedBrainId, "brain-1");

    instance.tick(16);
    assert.equal(instance.microbit.display.getPixelValue(0, 0), 0);

    instance.microbit.setButtonPressed("A", true);
    instance.tick(32);
    assert.equal(instance.microbit.display.getPixelValue(0, 0), 255);
  });

  it("flashes one instance without affecting another", () => {
    const env = microbitEnvironment();
    const sim = new MicrobitSimulator(env);
    const a = sim.getInstances()[0]!;
    const b = sim.addInstance();

    sim.flash(a.id, buttonDisplayInput(env), "brain-1");
    assert.equal(a.flashState.status, "loaded");
    assert.deepEqual(b.flashState, { status: "empty" });

    a.tick(16); // baseline: button up, establishes the released state for the edge
    a.microbit.setButtonPressed("A", true);
    a.tick(32);
    assert.equal(a.microbit.display.getPixelValue(0, 0), 255);
    assert.equal(b.microbit.display.getPixelValue(0, 0), 0);
  });

  it("re-flashing replaces the loaded program on that instance", () => {
    const env = microbitEnvironment();
    const sim = new MicrobitSimulator(env);
    const instance = sim.getInstances()[0]!;

    sim.flash(instance.id, buttonDisplayInput(env), "brain-1");
    sim.flash(instance.id, buttonDisplayInput(env), "brain-2");
    assert.deepEqual(instance.flashState, { status: "loaded", brainId: "brain-2" });
  });

  it("records a no-brain-selected state without throwing", () => {
    const sim = new MicrobitSimulator(microbitEnvironment());
    const instance = sim.getInstances()[0]!;
    sim.flash(instance.id, undefined, undefined);
    assert.deepEqual(instance.flashState, { status: "noBrainSelected" });
  });

  it("classifies a build/link failure into the failed flash state without throwing", () => {
    const env = microbitEnvironment();
    const sim = new MicrobitSimulator(env);
    const instance = sim.getInstances()[0]!;

    // Build the brain against the microbit env, then link it in a core-only env (missing the
    // microbit actions) to force a link failure.
    const input = buttonDisplayInput(env);
    const coreOnly = createMindcraftEnvironment({ modules: [coreModule()] });
    sim.flash(instance.id, { ...input, environment: coreOnly }, "brain-1");

    assert.equal(instance.flashState.status, "failed");
    if (instance.flashState.status !== "failed") {
      assert.fail("expected a failed flash state");
    }
    assert.ok(instance.flashState.errors.length > 0);
  });

  it("notifies instance-list subscribers when flash state changes", () => {
    const env = microbitEnvironment();
    const sim = new MicrobitSimulator(env);
    const instance = sim.getInstances()[0]!;
    let notifications = 0;
    const unsubscribe = sim.subscribeToInstances(() => {
      notifications++;
    });
    sim.flash(instance.id, buttonDisplayInput(env), "brain-1");
    unsubscribe();
    assert.equal(notifications, 1);
  });

  it("reflash re-flashes only the instances loaded with the given brain", () => {
    const env = microbitEnvironment();
    const sim = new MicrobitSimulator(env);
    const a = sim.getInstances()[0]!;
    const b = sim.addInstance();
    const c = sim.addInstance();

    sim.flash(a.id, buttonDisplayInput(env), "brain-1");
    sim.flash(b.id, buttonDisplayInput(env), "brain-2");
    // c is left unloaded.

    const aBefore = a.flashState;
    const bBefore = b.flashState;
    const cBefore = c.flashState;

    sim.reflash("brain-1", buttonDisplayInput(env));

    // a (brain-1) was re-flashed: a fresh flash-state object with the same content.
    assert.notEqual(a.flashState, aBefore);
    assert.deepEqual(a.flashState, { status: "loaded", brainId: "brain-1" });
    // b (brain-2) and c (unloaded) are untouched: same state objects.
    assert.equal(b.flashState, bBefore);
    assert.equal(c.flashState, cBefore);
  });

  it("unflash unloads and clears only the instances loaded with the given brain", () => {
    const env = microbitEnvironment();
    const sim = new MicrobitSimulator(env);
    const a = sim.getInstances()[0]!;
    const b = sim.addInstance();

    sim.flash(a.id, buttonDisplayInput(env), "brain-1");
    sim.flash(b.id, buttonDisplayInput(env), "brain-2");

    // Run a's button-display program so its display is lit.
    a.tick(16);
    a.microbit.setButtonPressed("A", true);
    a.tick(32);
    assert.equal(a.microbit.display.getPixelValue(0, 0), 255);

    const bBefore = b.flashState;
    sim.unflash("brain-1");

    // a is unflashed: empty state, device reset (display cleared, time back to zero), tick now a no-op.
    assert.deepEqual(a.flashState, { status: "empty" });
    assert.equal(a.microbit.display.getPixelValue(0, 0), 0);
    assert.equal(a.snapshot().time, 0);
    a.tick(16);
    assert.equal(a.snapshot().time, 0);
    // b (brain-2) untouched.
    assert.equal(b.flashState, bBefore);
  });
});
