import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BrainDef,
  CoreTypeIds,
  coreModule,
  createWendooEnvironment,
  mkActuatorTileId,
  mkModifierTileId,
  mkNumberValue,
  mkSensorTileId,
  type WendooEnvironment,
} from "@wendoo/core/app";
import { __test__appendTile } from "@wendoo/core/brain/__test__";
import { ErrorCode, type LinkedBrainProgramJson, linkedBrainProgramFromJson, Op } from "@wendoo/core/runtime";
import {
  buildWodalProgramImage,
  getWodalDeviceProfile,
  type WodalBuildInput,
  WodalDeviceProfileId,
} from "@wendoo/wodal";
import {
  createMicroBitV2Environment,
  MicroBitV2HostActions,
  WodalMicroBitV2ModifierId,
} from "@wendoo/wodal/targets/microbit-v2";
import { type InstanceFiberFault, MicrobitSimulator } from "./simulator";

/**
 * Hand-authors a minimal program image whose single root rule throws an
 * uncaught error carrying `message`, so loading it and ticking raises a VM
 * fiber fault with that verbatim message.
 */
function buildFaultingImage(message: string) {
  const profile = getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2);
  const json: LinkedBrainProgramJson = {
    program: {
      version: 1,
      functions: [
        {
          code: [{ op: Op.PUSH_CONST_VAL, a: 0 }, { op: Op.THROW }],
          numParams: 0,
          numLocals: 0,
        },
      ],
      constantPools: {
        numbers: [],
        strings: [],
        values: [{ t: "err", e: { code: ErrorCode.ScriptError, message } }],
      },
      types: [],
      variableNames: [],
      entryPoint: 0,
      actions: [],
      ruleFuncIds: [0],
      ruleAncestors: [],
    },
    pages: [
      {
        pageIndex: 0,
        pageId: "faulting-page",
        pageName: "Faulting",
        rootRuleFuncIds: [0],
        actionCallSites: [],
      },
    ],
  };
  return profile.createProgramImage(linkedBrainProgramFromJson(json));
}

function microbitEnvironment(): WendooEnvironment {
  return createMicroBitV2Environment();
}

/** Builds a minimal, API-generated program image so a loaded instance has something to tick. */
function buildMinimalImage(env: WendooEnvironment) {
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
function buttonDisplayInput(env: WendooEnvironment): WodalBuildInput {
  const services = env.brainServices;
  const sensorTile = services.edit.tiles.get(mkSensorTileId(MicroBitV2HostActions.ButtonA.key))!;
  const actuatorTile = services.edit.tiles.get(mkActuatorTileId(MicroBitV2HostActions.DisplaySetPixel.key))!;
  const brainDef = BrainDef.emptyBrainDef(services, "button display");
  const rule = brainDef.pages().get(0)!.children().get(0)!;
  __test__appendTile(rule.when(), sensorTile);
  __test__appendTile(rule.do(), actuatorTile);
  return { brainDef, environment: env, deviceProfile: getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2) };
}

/** Builds a `WHEN button A held DO radio send <value>` sender brain through the tile API. */
function radioSenderInput(env: WendooEnvironment, value: number): WodalBuildInput {
  const services = env.brainServices;
  const sensorTile = services.edit.tiles.get(mkSensorTileId(MicroBitV2HostActions.ButtonA.key))!;
  const heldTile = services.edit.tiles.get(mkModifierTileId(WodalMicroBitV2ModifierId.Held))!;
  const sendTile = services.edit.tiles.get(mkActuatorTileId(MicroBitV2HostActions.RadioSend.key))!;
  const brainDef = BrainDef.emptyBrainDef(services, "radio sender");
  const rule = brainDef.pages().get(0)!.children().get(0)!;
  __test__appendTile(rule.when(), sensorTile);
  __test__appendTile(rule.when(), heldTile);
  __test__appendTile(rule.do(), sendTile);
  rule.do().appendTile(
    services.edit.tileBuilder.createLiteralTileDef(brainDef.catalog(), CoreTypeIds.Number, mkNumberValue(value), {
      valueLabel: String(value),
      persist: true,
    })
  );
  return { brainDef, environment: env, deviceProfile: getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2) };
}

/** Builds a `WHEN radio receive number DO set pixel (0,0)` receiver brain through the tile API. */
function radioReceiverInput(env: WendooEnvironment): WodalBuildInput {
  const services = env.brainServices;
  const sensorTile = services.edit.tiles.get(mkSensorTileId(MicroBitV2HostActions.RadioReceiveNumber.key))!;
  const actuatorTile = services.edit.tiles.get(mkActuatorTileId(MicroBitV2HostActions.DisplaySetPixel.key))!;
  const brainDef = BrainDef.emptyBrainDef(services, "radio receiver");
  const rule = brainDef.pages().get(0)!.children().get(0)!;
  __test__appendTile(rule.when(), sensorTile);
  __test__appendTile(rule.do(), actuatorTile);
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

  it("classifies a build/link failure into the failed flash state without throwing", () => {
    const env = microbitEnvironment();
    const sim = new MicrobitSimulator(env);
    const instance = sim.getInstances()[0]!;

    // Build the brain against the microbit env, then link it in a core-only env (missing the
    // microbit actions) to force a link failure.
    const input = buttonDisplayInput(env);
    const coreOnly = createWendooEnvironment({ modules: [coreModule()] });
    sim.flash(instance.id, { ...input, environment: coreOnly }, "brain-1");

    assert.equal(instance.flashState.status, "failed");
    if (instance.flashState.status !== "failed") {
      assert.fail("expected a failed flash state");
    }
    assert.ok(instance.flashState.errors.length > 0);
    assert.equal(instance.flashState.brainId, "brain-1");
    assert.equal(instance.flashedBrainId, "brain-1");
  });

  it("a failed flash keeps the association: reflash heals it and unflash clears it", () => {
    const env = microbitEnvironment();
    const sim = new MicrobitSimulator(env);
    const instance = sim.getInstances()[0]!;

    // A link failure (core-only env lacks the microbit actions) leaves the instance failed.
    const coreOnly = createWendooEnvironment({ modules: [coreModule()] });
    sim.flash(instance.id, { ...buttonDisplayInput(env), environment: coreOnly }, "brain-1");
    assert.equal(instance.flashState.status, "failed");
    assert.equal(instance.flashedBrainId, "brain-1");

    // A successful rebuild re-flashes the associated instance back to loaded.
    sim.reflash("brain-1", buttonDisplayInput(env));
    assert.deepEqual(instance.flashState, { status: "loaded", brainId: "brain-1" });

    // A failed association is cleared by unflash (the brain-deletion path).
    sim.flash(instance.id, { ...buttonDisplayInput(env), environment: coreOnly }, "brain-1");
    assert.equal(instance.flashState.status, "failed");
    sim.unflash("brain-1");
    assert.deepEqual(instance.flashState, { status: "empty" });
    assert.equal(instance.flashedBrainId, undefined);
  });

  it("a failed reflash unloads the previously loaded program and blanks the device", () => {
    const env = microbitEnvironment();
    const sim = new MicrobitSimulator(env);
    const instance = sim.getInstances()[0]!;

    // Load a good program and light a pixel so a running program is observable.
    sim.flash(instance.id, buttonDisplayInput(env), "brain-1");
    instance.tick(16);
    instance.microbit.setButtonPressed("A", true);
    instance.tick(32);
    assert.equal(instance.microbit.display.getPixelValue(0, 0), 255);

    // Reflashing with a broken build (core-only env lacks the microbit actions) fails.
    const coreOnly = createWendooEnvironment({ modules: [coreModule()] });
    sim.reflash("brain-1", { ...buttonDisplayInput(env), environment: coreOnly });

    // The runtime is unloaded: device reset (display cleared, time back to zero), tick now a no-op.
    assert.equal(instance.flashState.status, "failed");
    assert.equal(instance.microbit.display.getPixelValue(0, 0), 0);
    assert.equal(instance.snapshot().time, 0);
    instance.tick(16);
    assert.equal(instance.snapshot().time, 0);
  });

  it("surfaces a failed flash's diagnostics under its brain, verbatim and deduplicated", () => {
    const env = microbitEnvironment();
    const sim = new MicrobitSimulator(env);
    const instance = sim.getInstances()[0]!;

    const coreOnly = createWendooEnvironment({ modules: [coreModule()] });
    sim.flash(instance.id, { ...buttonDisplayInput(env), environment: coreOnly }, "brain-1");

    const failed = instance.flashState;
    if (failed.status !== "failed") {
      assert.fail("expected a failed flash state");
    }
    // The brain-keyed diagnostics are exactly the failed flash's errors, verbatim.
    assert.deepEqual(sim.flashDiagnosticsForBrain("brain-1"), failed.errors);
    assert.ok(failed.errors.length > 0);
    // A brain with no failed instance surfaces nothing.
    assert.deepEqual(sim.flashDiagnosticsForBrain("brain-2"), []);
  });

  it("a thrown link error fails the flash and unloads, surfacing the thrown message verbatim", () => {
    const env = microbitEnvironment();
    const sim = new MicrobitSimulator(env);
    const instance = sim.getInstances()[0]!;

    // Load a good program first so there is a running program to unload.
    sim.flash(instance.id, buttonDisplayInput(env), "brain-1");
    instance.tick(16);
    instance.microbit.setButtonPressed("A", true);
    instance.tick(32);
    assert.equal(instance.microbit.display.getPixelValue(0, 0), 255);

    // An environment whose linkBrain throws must not float an unhandled rejection.
    const throwingEnv = {
      linkBrain() {
        throw new Error("linker exploded");
      },
    } as unknown as WendooEnvironment;
    assert.doesNotThrow(() => {
      sim.reflash("brain-1", { ...buttonDisplayInput(env), environment: throwingEnv });
    });

    assert.equal(instance.flashState.status, "failed");
    assert.equal(instance.microbit.display.getPixelValue(0, 0), 0);
    const diags = sim.flashDiagnosticsForBrain("brain-1");
    assert.equal(diags.length, 1);
    assert.equal(diags[0]!.message, "linker exploded");
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

  it("reflash re-flashes only the instances associated with the given brain", () => {
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

  it("unflash unloads and clears only the instances associated with the given brain", () => {
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

describe("MicrobitSimulator fiber faults", () => {
  it("routes a runtime fiber fault to subscribers tagged with the flashed brain id and verbatim message", () => {
    const env = microbitEnvironment();
    const sim = new MicrobitSimulator(env);
    const instance = sim.getInstances()[0]!;

    const faults: InstanceFiberFault[] = [];
    sim.subscribeToFiberFaults((fault) => faults.push(fault));

    // Associate the instance with a brain, then run a program that faults at runtime.
    instance.flashState = { status: "loaded", brainId: "brain-1" };
    instance.runtime.loadWodalProgramImage(buildFaultingImage("boom"));
    sim.tick(1);

    assert.ok(faults.length >= 1);
    assert.equal(faults[0]!.instanceId, instance.id);
    assert.equal(faults[0]!.brainId, "brain-1");
    assert.equal(faults[0]!.err.message, "boom");
  });

  it("stops delivering faults after unsubscribe", () => {
    const env = microbitEnvironment();
    const sim = new MicrobitSimulator(env);
    const instance = sim.getInstances()[0]!;

    let count = 0;
    const unsubscribe = sim.subscribeToFiberFaults(() => {
      count++;
    });
    instance.runtime.loadWodalProgramImage(buildFaultingImage("boom"));
    sim.tick(1);
    const afterFirst = count;
    assert.ok(afterFirst >= 1);

    unsubscribe();
    sim.tick(1);
    assert.equal(count, afterFirst);
  });
});

describe("MicrobitSimulator radio virtual ether", () => {
  const instanceById = (sim: MicrobitSimulator, id: string) =>
    sim.getInstances().find((instance) => instance.id === id)!;

  it("routes a send to a same-group instance (read next think) and not to a different group", () => {
    const env = microbitEnvironment();
    const sim = new MicrobitSimulator(env);
    sim.setInstances(["sender", "same", "other"]);
    sim.flash("sender", radioSenderInput(env, 5), "sender");
    sim.flash("same", radioReceiverInput(env), "receiver");
    sim.flash("other", radioReceiverInput(env), "receiver");
    // Groups are device state, set after the flash that resets the device.
    instanceById(sim, "sender").microbit.radio.setGroup(1);
    instanceById(sim, "same").microbit.radio.setGroup(1);
    instanceById(sim, "other").microbit.radio.setGroup(2);
    // The sender holds button A, so it transmits on every held think.
    instanceById(sim, "sender").microbit.setButtonPressed("A", true);

    // tick 1 seeds the sensors (no send / no edge); subsequent ticks send and,
    // a frame later, the same-group receiver reads the delivered packet.
    sim.tick(16);
    sim.tick(16);
    sim.tick(16);

    assert.equal(instanceById(sim, "same").microbit.display.getPixelValue(0, 0), 255);
    assert.equal(instanceById(sim, "other").microbit.display.getPixelValue(0, 0), 0);
  });

  /**
   * Two same-group senders transmit in one frame; the unloaded observer's ring
   * holds both. Returns the observer's received values, given the instance order
   * (which sets the tick order).
   */
  function twoSenderRun(order: readonly string[]): number[] {
    const env = microbitEnvironment();
    const sim = new MicrobitSimulator(env);
    sim.setInstances(order);
    sim.flash("a", radioSenderInput(env, 10), "sender-a");
    sim.flash("c", radioSenderInput(env, 20), "sender-c");
    for (const id of ["a", "b", "c"]) {
      instanceById(sim, id).microbit.radio.setGroup(1);
    }
    instanceById(sim, "a").microbit.setButtonPressed("A", true);
    instanceById(sim, "c").microbit.setButtonPressed("A", true);

    sim.tick(16); // seed the button sensors
    sim.tick(16); // a and c each send once; delivered at the frame boundary
    return instanceById(sim, "b")
      .microbit.radio.drainAfter(0)
      .map((packet) => packet.value);
  }

  it("delivers same-frame sends in a fixed sender-id order regardless of tick order", () => {
    const forward = twoSenderRun(["a", "b", "c"]);
    const reversed = twoSenderRun(["c", "b", "a"]);
    // Canonical order is by sender id (a before c), not by tick order.
    assert.deepEqual(forward, [10, 20]);
    assert.deepEqual(reversed, [10, 20]);
  });
});
