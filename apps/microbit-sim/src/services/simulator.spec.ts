import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BrainDef, coreModule, createMindcraftEnvironment, type MindcraftEnvironment } from "@mindcraft-lang/core/app";
import { buildWodalProgramImage, getWodalDeviceProfile, WodalDeviceProfileId } from "@mindcraft-lang/wodal";
import { createMicroBitV2Module } from "@mindcraft-lang/wodal/targets/microbit-v2";
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
