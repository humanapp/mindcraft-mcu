/**
 * Headless compile-and-run validation for the gamepad's radio pairing with the
 * Cutebot chassis. It compiles the shipped gamepad tiles, the Movement
 * arbitrator, and the `cutebot steer` bridge into real brains and runs them on
 * the WODAL microbit-v2 runtime, routing radio between two device instances
 * through a shared ether (the simulator's cross-instance delivery path).
 *
 * It pins: the steer bridge's exact wheel writes when driven by a whole
 * `Position`; the decoder's totality (a valid packet decodes; a short or
 * wrong-magic packet reads the centered idle position (0,0), which flows through
 * the pipeline as a real value - the consumer always runs; a WHEN with no Buffer
 * result is rejected at compile time); packet atomicity (both accessor reads come
 * from one decode); the position -> Buffer conversion's reach (offered in a Buffer
 * slot, and accepted by a second Buffer consumer with the exact bytes); the
 * stage-1 directional-string round trip into a movement influence; and the
 * stage-2 continuous-steering loop end to end - injected stick -> encode +
 * transmit the position -> receive -> decode -> steer -> exact wheels.
 *
 * The `cutebot steer` bridge takes one `Position`, so the decoder's whole
 * `[decoded stick position]` value flows directly into its single slot. The
 * derived `[x]` / `[y]` accessors remain first-class: the decoder's atomicity
 * tests read both through them, and both take the enclosing rule's one WHEN
 * result, so the x/y pair is atomic.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { List } from "@mindcraft-lang/core";
import {
  BrainDef,
  BrainTileLiteralDef,
  BrainTileModifierDef,
  CoreTypeIds,
  type MindcraftEnvironment,
  mkActuatorTileId,
  mkSensorTileId,
} from "@mindcraft-lang/core/app";
import { type IBrainTileDef, mkAccessorTileId, mkVariableFactoryTileId, RuleSide } from "@mindcraft-lang/core/brain";
import {
  type InsertionContext,
  parseTilesForSuggestions,
  suggestTiles,
} from "@mindcraft-lang/core/brain/language-service";
import type { BrainTileFactoryDef } from "@mindcraft-lang/core/brain/tiles";
import { mkStringValue, type TypeId } from "@mindcraft-lang/core/runtime";
import { buildWodalProgramImage, getWodalDeviceProfile, WodalDeviceProfileId } from "@mindcraft-lang/wodal";
import {
  type IncomingRadioPacket,
  MicroBit,
  type RadioSendRecord,
  WodalMicroBitRuntime,
} from "@mindcraft-lang/wodal/targets/microbit-v2";
import {
  buildExampleHarness,
  CUTEBOT_EXT_COORDINATE,
  type ExampleHarness,
  POSITION_IDENTITY,
  YAHBOOM_GAMEPAD_EXT_COORDINATE,
} from "./example-harness";

/** Cutebot STM8 motor-driver I2C address the arbitrator writes wheel commands to. */
const CHASSIS_ADDRESS = 0x10;
/** Addresses the x/y number observers mirror to, biased so a signed value survives as a byte. */
const OBS_X_ADDRESS = 0x60;
const OBS_Y_ADDRESS = 0x62;
const OBSERVER_BIAS = 100;
/** Address the Buffer-consumer probe folds a converted packet's bytes to. */
const FOLD_ADDRESS = 0x61;

/** BUFFER radio packet type id. */
const BUFFER_PACKET = 3;

/** Gamepad state packet magic and the tile ids for the radio surface (consumed as-is). */
const PACKET_MAGIC = 0x47;
const RADIO_SEND = "microbit-v2.radio-send";
const RADIO_RECEIVE_BUFFER = "microbit-v2.radio-receive-buffer";
const RADIO_RECEIVE_STRING = "microbit-v2.radio-receive-string";

/** Stick analog axes and the pull-up press line. */
const VERTICAL_PIN = 1;
const HORIZONTAL_PIN = 2;
const PRESS_PIN = 8;
const HORIZONTAL_REST = 502;

const ALWAYS_SOURCE = `import { type Context, Sensor } from "mindcraft";

export default Sensor({
  name: "always",
  onExecute(ctx: Context): boolean {
    return ctx.microbit.buttonA.isPressed() >= 0;
  },
});
`;

/**
 * A test-only actuator that mirrors two anonymous number arguments to biased I2C
 * bytes at the x and y observer addresses. Reading both in one rule lets both
 * decoder evaluations share one WHEN result, so the x/y pair is atomic.
 */
const OBSERVE_PAIR_SOURCE = `import { Actuator, type Context, NumberType, param } from "mindcraft";

export default Actuator({
  name: "observe pair",
  args: [param("x", { type: NumberType, anonymous: true }), param("y", { type: NumberType, anonymous: true })],
  onExecute(ctx: Context, args: { x: number; y: number }): void {
    ctx.microbit.i2c.writeBuffer(${OBS_X_ADDRESS}, Buffer.from([args.x + ${OBSERVER_BIAS}]));
    ctx.microbit.i2c.writeBuffer(${OBS_Y_ADDRESS}, Buffer.from([args.y + ${OBSERVER_BIAS}]));
  },
});
`;

/** A second Buffer-expected consumer: folds a packet's three bytes to one I2C write. */
const FOLD_SOURCE = `import { Actuator, BufferType, type Context, param } from "mindcraft";

export default Actuator({
  name: "buffer fold",
  args: [param("packet", { type: BufferType, anonymous: true })],
  onExecute(ctx: Context, args: { packet: Buffer }): void {
    const bytes = args.packet;
    ctx.microbit.i2c.writeBuffer(${FOLD_ADDRESS}, Buffer.from([bytes.get(0), bytes.get(1), bytes.get(2)]));
  },
});
`;

/**
 * The test-only trigger and observer tiles compiled in the host workspace. The
 * gamepad tiles, the Cutebot movement System and steer bridge, and the Position
 * struct type come from their installed extension namespaces.
 */
function workspaceTiles(): Record<string, string> {
  return {
    "always.ts": ALWAYS_SOURCE,
    "observe-pair.ts": OBSERVE_PAIR_SOURCE,
    "fold.ts": FOLD_SOURCE,
  };
}

const environment = { current: undefined as MindcraftEnvironment | undefined };
const bundleTiles = { current: [] as readonly IBrainTileDef[] };
const harnessRef = { current: undefined as ExampleHarness | undefined };

before(() => {
  const harness = buildExampleHarness({
    install: [CUTEBOT_EXT_COORDINATE, YAHBOOM_GAMEPAD_EXT_COORDINATE],
    workspaceTiles: workspaceTiles(),
  });
  harnessRef.current = harness;
  bundleTiles.current = harness.bundle.tiles;
  environment.current = harness.env;
});

/** Resolves a compiled user tile by its display name. */
function userTile(name: string): IBrainTileDef {
  return harnessRef.current!.userTile(name);
}

/** Resolves a registered core/host tile by its action key. */
function hostTile(env: MindcraftEnvironment, tileId: string): IBrainTileDef {
  const tile = env.brainServices.edit.tiles.get(tileId);
  assert.ok(tile, `host tile ${tileId} should be registered`);
  return tile;
}

/** The registered TypeId of the position struct. */
function positionTypeId(env: MindcraftEnvironment): TypeId {
  const typeId = env.brainServices.runtime.types.resolveByName(POSITION_IDENTITY);
  assert.ok(typeId, "expected the position type to be registered");
  return typeId;
}

/** The accessor tile reading `field` off a position value. */
function accessorTile(env: MindcraftEnvironment, field: string): IBrainTileDef {
  const tileId = mkAccessorTileId(positionTypeId(env), field);
  const tile = bundleTiles.current.find((candidate) => candidate.tileId === tileId);
  assert.ok(tile, `expected the "${field}" accessor tile`);
  return tile;
}

/** Manufactures and registers a fresh position variable tile named `name` in `brainDef`. */
function positionVariable(env: MindcraftEnvironment, brainDef: BrainDef, name: string): IBrainTileDef {
  const factory = bundleTiles.current.find((tile) => tile.tileId === mkVariableFactoryTileId(positionTypeId(env))) as
    | BrainTileFactoryDef
    | undefined;
  assert.ok(factory, "expected the position variable factory in the bundle");
  const variable = factory.manufacture(factory, { name });
  assert.ok(variable, "the factory manufactured a position variable tile");
  brainDef.catalog().registerTileDef(variable);
  return variable;
}

/** Builds a wodal image for `brainDef`, asserting the build succeeds. */
function buildImage(env: MindcraftEnvironment, brainDef: BrainDef) {
  const built = buildWodalProgramImage({
    brainDef,
    environment: env,
    deviceProfile: getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2),
  });
  assert.ok(built.ok, `expected a successful build: ${built.ok ? "" : JSON.stringify(built.errors)}`);
  return built.image;
}

/** The received-packet form of a transmitted packet, stamping synthetic sim metadata. */
function toIncoming(record: RadioSendRecord): IncomingRadioPacket {
  return {
    type: record.type,
    group: record.group,
    value: record.value,
    name: record.name,
    text: record.text,
    bytes: record.bytes,
    rssi: -42,
    serial: 0,
    time: 0,
  };
}

/** An injected incoming BUFFER packet carrying `bytes` on group 0. */
function bufferPacket(bytes: readonly number[]): IncomingRadioPacket {
  return {
    type: BUFFER_PACKET,
    group: 0,
    value: 0,
    name: "",
    text: "",
    bytes: new Uint8Array(bytes),
    rssi: -42,
    serial: 0,
    time: 0,
  };
}

/** The state-packet bytes `[magic, x + 100, y + 100]`. */
function packetBytes(magic: number, x: number, y: number): number[] {
  return [magic, x + 100, y + 100];
}

/** Decodes the signed (left, right) wheel pair from a tick's two chassis commands. */
function decodeWheels(commands: number[][]): [number, number] {
  assert.equal(commands.length, 2, "expected exactly two wheel commands");
  const left = commands.find((c) => c[0] === 0x01);
  const right = commands.find((c) => c[0] === 0x02);
  assert.ok(left && right, "expected one left and one right command");
  const signed = (command: number[]): number => (command[1] === 0x01 && command[2] !== 0 ? -command[2]! : command[2]!);
  return [signed(left), signed(right)];
}

/** One scheduled think and the pin / packet input injected before it runs. */
interface Step {
  readonly analog?: Readonly<Record<number, number>>;
  readonly digital?: Readonly<Record<number, number>>;
  readonly inject?: readonly IncomingRadioPacket[];
}

/** What a single-brain run observed: chassis wheel pairs and observer bytes, each by tick. */
interface RunResult {
  readonly wheels: ReadonlyMap<number, number[][]>;
  readonly bytes: readonly { readonly address: number; readonly data: number[]; readonly tick: number }[];
}

/** Runs one brain over `schedule`, injecting packets and pin levels, and taps the I2C bus. */
function run(env: MindcraftEnvironment, brainDef: BrainDef, schedule: readonly Step[]): RunResult {
  const image = buildImage(env, brainDef);
  const microbit = new MicroBit();
  let tick = 0;
  const wheels = new Map<number, number[][]>();
  const bytes: { address: number; data: number[]; tick: number }[] = [];
  const rawWrite = microbit.i2c.write.bind(microbit.i2c);
  microbit.i2c.write = (address, data) => {
    if (address === CHASSIS_ADDRESS) {
      const commands = wheels.get(tick) ?? [];
      commands.push([...data]);
      wheels.set(tick, commands);
    } else {
      bytes.push({ address, data: [...data], tick });
    }
    return rawWrite(address, data);
  };

  const runtime = new WodalMicroBitRuntime({ environment: env, microbit });
  assert.deepEqual(runtime.loadWodalProgramImage(image), { ok: true }, "program should load");

  for (const [index, step] of schedule.entries()) {
    tick = index + 1;
    for (const packet of step.inject ?? []) microbit.radio.deliver(packet);
    if (step.analog) {
      for (const [pin, level] of Object.entries(step.analog)) microbit.gpio.setAnalogRead(Number(pin), level);
    }
    if (step.digital) {
      for (const [pin, level] of Object.entries(step.digital)) microbit.gpio.setDigitalRead(Number(pin), level);
    }
    runtime.tick(16);
  }
  return { wheels, bytes };
}

/** The signed (left, right) wheel pair written on `tick`. */
function wheelsAt(result: RunResult, tick: number): [number, number] {
  const commands = result.wheels.get(tick);
  assert.ok(commands, `expected chassis writes on tick ${tick}`);
  return decodeWheels(commands);
}

/** The de-biased value the observer at `address` wrote on `tick`; asserts exactly one write (the consumer ran once). */
function observedAt(result: RunResult, address: number, tick: number): number {
  const match = result.bytes.filter((entry) => entry.address === address && entry.tick === tick);
  assert.equal(match.length, 1, `expected one observer write to ${address} on tick ${tick}`);
  return match[0]!.data[0]! - OBSERVER_BIAS;
}

describe("cutebot steer bridge", () => {
  /** WHEN [radio receive buffer] DO [cutebot steer [decoded stick position]], fed a packet carrying (x, y). */
  function steerBrain(env: MindcraftEnvironment): BrainDef {
    const brainDef = BrainDef.emptyBrainDef(env.brainServices, "steer whole position");
    const rule = brainDef.pages().get(0)!.children().get(0)!;
    rule.when().appendTile(hostTile(env, mkSensorTileId(RADIO_RECEIVE_BUFFER)));
    rule.do().appendTile(userTile("cutebot steer"));
    rule.do().appendTile(userTile("decoded stick position"));
    return brainDef;
  }

  test("the whole decoded position maps to turn/drive and blends into exact wheel writes", () => {
    const env = environment.current!;
    const cases: { x: number; y: number; wheels: [number, number] }[] = [
      { x: 0, y: 100, wheels: [100, 100] }, // straight forward
      { x: 0, y: -100, wheels: [-100, -100] }, // straight back
      { x: 100, y: 100, wheels: [100, 50] }, // forward-right, saturated
      { x: -100, y: 0, wheels: [0, 100] }, // spin-arc left, held wheel at rest
      { x: 50, y: 50, wheels: [100, 50] }, // gentle forward-right
      { x: 0, y: 0, wheels: [0, 0] }, // centered = commanded stop
    ];
    for (const { x, y, wheels } of cases) {
      // Tick 1 arms the receive cursor; the packet lands before tick 2, so the
      // steer reads the whole decoded position on tick 2.
      const result = run(env, steerBrain(env), [{}, { inject: [bufferPacket(packetBytes(PACKET_MAGIC, x, y))] }]);
      assert.deepEqual(wheelsAt(result, 2), wheels, `steer(${x}, ${y}) writes (${wheels[0]}, ${wheels[1]})`);
    }
  });

  test("the cutebot steer position slot offers whole-position producers", () => {
    const env = environment.current!;
    // WHEN [radio receive buffer] supplies the Buffer WHEN result the decoder
    // consumes; the DO side holds just the steer tile, its single Position slot
    // open for a whole-position value.
    const brainDef = BrainDef.emptyBrainDef(env.brainServices, "steer picker");
    const rule = brainDef.pages().get(0)!.children().get(0)!;
    rule.when().appendTile(hostTile(env, mkSensorTileId(RADIO_RECEIVE_BUFFER)));
    rule.do().appendTile(userTile("cutebot steer"));
    const posVar = positionVariable(env, brainDef, "held");

    const expr = parseTilesForSuggestions(rule.do().tiles());
    const ctx: InsertionContext = { ruleSide: RuleSide.Do, expr, ruleDef: rule };
    const result = suggestTiles(ctx, List.from([...env.tileCatalogs(), brainDef.catalog()]), env.brainServices);
    const offered = new Set<string>();
    for (let i = 0; i < result.exact.size(); i++) offered.add(result.exact.get(i).tileDef.tileId);
    for (let i = 0; i < result.withConversion.size(); i++) offered.add(result.withConversion.get(i).tileDef.tileId);

    assert.ok(
      offered.has(userTile("decoded stick position").tileId),
      "the whole decoded position is offered for the steer slot"
    );
    assert.ok(
      offered.has(userTile("stick position").tileId),
      "the stick position sensor is offered for the steer slot"
    );
    assert.ok(offered.has(posVar.tileId), "a position variable is offered for the steer slot");
  });
});

describe("decoded stick position", () => {
  /**
   * A brain that decodes inline and mirrors the two fields through the
   * accessors: `WHEN [when] DO [observe pair [decoded stick position][x]
   * [decoded stick position][y]]`. Both decoder evaluations read the one rule's
   * WHEN result, so the x/y pair comes from a single packet.
   */
  function decodeBrain(env: MindcraftEnvironment, name: string, when: IBrainTileDef): BrainDef {
    const brainDef = BrainDef.emptyBrainDef(env.brainServices, name);
    const rule = brainDef.pages().get(0)!.children().get(0)!;
    rule.when().appendTile(when);
    rule.do().appendTile(userTile("observe pair"));
    rule.do().appendTile(userTile("decoded stick position"));
    rule.do().appendTile(accessorTile(env, "x"));
    rule.do().appendTile(userTile("decoded stick position"));
    rule.do().appendTile(accessorTile(env, "y"));
    return brainDef;
  }

  test("a valid packet decodes; a wrong-magic or short packet reads the centered idle position", () => {
    const env = environment.current!;
    const receive = hostTile(env, mkSensorTileId(RADIO_RECEIVE_BUFFER));
    const cases: { name: string; bytes: number[]; x: number; y: number }[] = [
      { name: "valid packet", bytes: packetBytes(PACKET_MAGIC, 50, -25), x: 50, y: -25 },
      { name: "wrong magic", bytes: packetBytes(0x00, 50, -25), x: 0, y: 0 },
      { name: "too short", bytes: [PACKET_MAGIC, 150], x: 0, y: 0 },
    ];
    for (const { name, bytes, x, y } of cases) {
      // Tick 1 activates the page and arms the receive cursor; the packet lands
      // before tick 2, so the receive rule reads it on tick 2. The centered
      // (0, 0) case still writes: (0, 0) is a real value, never dropped, so the
      // consuming observer runs exactly once (observedAt asserts one write).
      const result = run(env, decodeBrain(env, `decode ${name}`, receive), [{}, { inject: [bufferPacket(bytes)] }]);
      assert.equal(observedAt(result, OBS_X_ADDRESS, 2), x, `${name}: x = ${x}`);
      assert.equal(observedAt(result, OBS_Y_ADDRESS, 2), y, `${name}: y = ${y}`);
    }
  });

  test("both accessor reads come from the same decoded packet (atomicity)", () => {
    const env = environment.current!;
    const receive = hostTile(env, mkSensorTileId(RADIO_RECEIVE_BUFFER));
    // Distinct x and y, so a mismatched pairing would be visible.
    const brainDef = decodeBrain(env, "decode atomic", receive);
    const result = run(env, brainDef, [{}, { inject: [bufferPacket(packetBytes(PACKET_MAGIC, 42, -17))] }]);
    assert.equal(observedAt(result, OBS_X_ADDRESS, 2), 42, "x from the one packet");
    assert.equal(observedAt(result, OBS_Y_ADDRESS, 2), -17, "y from the same packet");
  });

  test("a WHEN with no Buffer result rejects the decoder at compile time", () => {
    const env = environment.current!;
    // Under an always (boolean) WHEN there is no Buffer WHEN result for the
    // decoder to read, so the build rejects the brain with the WHEN-result
    // diagnostic naming the decoder tile.
    const built = buildWodalProgramImage({
      brainDef: decodeBrain(env, "decode no-buffer", userTile("always")),
      environment: env,
      deviceProfile: getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2),
    });
    assert.ok(!built.ok, "the decoder without a Buffer WHEN result must not compile");
    assert.ok(
      built.errors.some(
        (error) => error.message.includes(`"decoded stick position"`) && error.message.includes("WHEN")
      ),
      `the rejection names the decoder tile and the WHEN result it needs: ${JSON.stringify(built.errors)}`
    );
  });

  test("the idle (0,0) flows through cutebot steer as a commanded stop, not silence", () => {
    const env = environment.current!;
    // WHEN [radio receive buffer] DO [cutebot steer [decoded stick position]].
    const brainDef = BrainDef.emptyBrainDef(env.brainServices, "decode steer idle");
    const rule = brainDef.pages().get(0)!.children().get(0)!;
    rule.when().appendTile(hostTile(env, mkSensorTileId(RADIO_RECEIVE_BUFFER)));
    rule.do().appendTile(userTile("cutebot steer"));
    rule.do().appendTile(userTile("decoded stick position"));
    // Tick 2 steers to a non-zero state from a valid packet; tick 3 delivers a
    // non-gamepad buffer that decodes to (0, 0). The wheels drop to (0, 0) on
    // tick 3 immediately - if the (0, 0) decode were treated as falsy and the
    // steer skipped, the Movement hold window would instead reuse (100, 50). The
    // immediate stop proves (0, 0) is emitted as a commanded value.
    const result = run(env, brainDef, [
      {},
      { inject: [bufferPacket(packetBytes(PACKET_MAGIC, 100, 100))] },
      { inject: [bufferPacket(packetBytes(0x00, 50, 100))] },
    ]);
    assert.deepEqual(wheelsAt(result, 2), [100, 50], "the valid packet steers to a non-zero state");
    assert.deepEqual(wheelsAt(result, 3), [0, 0], "the idle (0, 0) commands a stop immediately, not a hold");
  });
});

describe("position -> Buffer conversion reach", () => {
  test("the picker offers a position in a Buffer slot as a conversion match", () => {
    const env = environment.current!;
    // A position-typed variable in the buffer-fold slot: an exact Buffer match is
    // impossible, but the registered position -> Buffer conversion makes it a
    // conversion match.
    const scratch = BrainDef.emptyBrainDef(env.brainServices, "conversion picker");
    const posVar = positionVariable(env, scratch, "held");
    const expr = parseTilesForSuggestions(List.from([userTile("buffer fold")]));
    const ctx: InsertionContext = { ruleSide: RuleSide.Do, expr };
    const result = suggestTiles(ctx, List.from([...env.tileCatalogs(), scratch.catalog()]), env.brainServices);
    const exact = new Set<string>();
    for (let i = 0; i < result.exact.size(); i++) exact.add(result.exact.get(i).tileDef.tileId);
    const withConversion = new Set<string>();
    for (let i = 0; i < result.withConversion.size(); i++)
      withConversion.add(result.withConversion.get(i).tileDef.tileId);
    assert.ok(!exact.has(posVar.tileId), "a position is not an exact Buffer match");
    assert.ok(withConversion.has(posVar.tileId), "the position is offered as a conversion match in a Buffer slot");
  });

  test("the picker offers the position variable and the inline sensor in the radio send slot", () => {
    const env = environment.current!;
    // The radio send tile's value slot is a Number/String/Boolean/Buffer
    // choice; the position -> Buffer conversion makes both position producers
    // conversion matches there.
    const scratch = BrainDef.emptyBrainDef(env.brainServices, "radio send picker");
    const posVar = positionVariable(env, scratch, "aimed");
    const stickSensor = userTile("stick position");
    const expr = parseTilesForSuggestions(List.from([hostTile(env, mkActuatorTileId(RADIO_SEND))]));
    const ctx: InsertionContext = { ruleSide: RuleSide.Do, expr };
    const result = suggestTiles(ctx, List.from([...env.tileCatalogs(), scratch.catalog()]), env.brainServices);
    const exact = new Set<string>();
    for (let i = 0; i < result.exact.size(); i++) exact.add(result.exact.get(i).tileDef.tileId);
    const withConversion = new Set<string>();
    for (let i = 0; i < result.withConversion.size(); i++)
      withConversion.add(result.withConversion.get(i).tileDef.tileId);
    for (const tile of [posVar, stickSensor]) {
      assert.ok(!exact.has(tile.tileId), `${tile.tileId} is not an exact match in the choice slot`);
      assert.ok(withConversion.has(tile.tileId), `${tile.tileId} is offered as a conversion match in the choice slot`);
    }
  });

  test("a second Buffer consumer accepts a position through the conversion with exact bytes", () => {
    const env = environment.current!;
    const brainDef = BrainDef.emptyBrainDef(env.brainServices, "conversion second consumer");
    const rule = brainDef.pages().get(0)!.children().get(0)!;
    rule.when().appendTile(userTile("always"));
    rule.do().appendTile(userTile("buffer fold"));
    rule.do().appendTile(userTile("stick position"));
    // Stick at x = 50 (raw 226), y = -25 (raw 667) -> packet [0x47, 150, 75].
    const result = run(env, brainDef, [
      { analog: { [VERTICAL_PIN]: 667, [HORIZONTAL_PIN]: 226 }, digital: { [PRESS_PIN]: 1 } },
    ]);
    const fold = result.bytes.filter((entry) => entry.address === FOLD_ADDRESS && entry.tick === 1);
    assert.equal(fold.length, 1, "the fold actuator wrote once");
    assert.deepEqual(fold[0]!.data, [PACKET_MAGIC, 150, 75], "the position encodes to the exact state packet");
  });
});

/** Runs a sender and a receiver brain in lockstep, routing the sender's radio into the receiver. */
function runPair(
  env: MindcraftEnvironment,
  sender: BrainDef,
  receiver: BrainDef,
  schedule: readonly Step[]
): ReadonlyMap<number, number[][]> {
  const senderImage = buildImage(env, sender);
  const receiverImage = buildImage(env, receiver);
  const senderBit = new MicroBit();
  const receiverBit = new MicroBit();
  senderBit.radio.setSendListener((record) => {
    if (record.group === receiverBit.radio.group) {
      receiverBit.radio.deliver(toIncoming(record));
    }
  });

  const wheels = new Map<number, number[][]>();
  let tick = 0;
  const rawWrite = receiverBit.i2c.write.bind(receiverBit.i2c);
  receiverBit.i2c.write = (address, data) => {
    if (address === CHASSIS_ADDRESS) {
      const commands = wheels.get(tick) ?? [];
      commands.push([...data]);
      wheels.set(tick, commands);
    }
    return rawWrite(address, data);
  };

  const senderRuntime = new WodalMicroBitRuntime({ environment: env, microbit: senderBit });
  const receiverRuntime = new WodalMicroBitRuntime({ environment: env, microbit: receiverBit });
  assert.deepEqual(senderRuntime.loadWodalProgramImage(senderImage), { ok: true }, "sender loads");
  assert.deepEqual(receiverRuntime.loadWodalProgramImage(receiverImage), { ok: true }, "receiver loads");

  for (const [index, step] of schedule.entries()) {
    tick = index + 1;
    if (step.analog) {
      for (const [pin, level] of Object.entries(step.analog)) senderBit.gpio.setAnalogRead(Number(pin), level);
    }
    if (step.digital) {
      for (const [pin, level] of Object.entries(step.digital)) senderBit.gpio.setDigitalRead(Number(pin), level);
    }
    // The sender transmits first; its packet lands in the receiver's ring before the receiver thinks.
    senderRuntime.tick(16);
    receiverRuntime.tick(16);
  }
  return wheels;
}

describe("radio pairing", () => {
  test("stage 1: a directional string round-trips into a movement influence", () => {
    const env = environment.current!;
    // Gamepad: WHEN [stick][up] DO [radio send "go"].
    const gamepad = BrainDef.emptyBrainDef(env.brainServices, "gamepad stage 1");
    const sendRule = gamepad.pages().get(0)!.children().get(0)!;
    sendRule.when().appendTile(userTile("stick"));
    sendRule.when().appendTile(new BrainTileModifierDef("modifier.direction.up"));
    sendRule.do().appendTile(hostTile(env, mkActuatorTileId(RADIO_SEND)));
    sendRule
      .do()
      .appendTile(
        new BrainTileLiteralDef(
          CoreTypeIds.String,
          mkStringValue("go"),
          { valueLabel: "go", persist: true },
          env.brainServices
        )
      );

    // Chassis: WHEN [radio receive string] DO [cutebot drive].
    const chassis = BrainDef.emptyBrainDef(env.brainServices, "chassis stage 1");
    const driveRule = chassis.pages().get(0)!.children().get(0)!;
    driveRule.when().appendTile(hostTile(env, mkSensorTileId(RADIO_RECEIVE_STRING)));
    driveRule.do().appendTile(userTile("cutebot drive"));

    // Stick pushed up (vertical raw < 200) so the gamepad transmits each think.
    const up: Step = {
      analog: { [VERTICAL_PIN]: 100, [HORIZONTAL_PIN]: HORIZONTAL_REST },
      digital: { [PRESS_PIN]: 1 },
    };
    const wheels = runPair(env, gamepad, chassis, [up, up, up]);
    // The chassis arms its cursor on think 1 and reads the command on think 2.
    assert.deepEqual(decodeWheels(wheels.get(2)!), [50, 50], "the received command drives the chassis forward");
  });

  test("stage 2: injected stick -> send [stick position] -> receive -> decode -> steer -> exact wheels", () => {
    const env = environment.current!;
    // Gamepad: WHEN [always] DO [radio send [stick position]] -- the spec's
    // real wiring. The inline position sensor fills the send tile's choice
    // value slot, and the position -> Buffer conversion encodes the packet.
    const gamepad = BrainDef.emptyBrainDef(env.brainServices, "gamepad stage 2");
    const broadcast = gamepad.pages().get(0)!.children().get(0)!;
    broadcast.when().appendTile(userTile("always"));
    broadcast.do().appendTile(hostTile(env, mkActuatorTileId(RADIO_SEND)));
    broadcast.do().appendTile(userTile("stick position"));

    // Chassis: WHEN [radio receive buffer] DO
    //   [cutebot steer [decoded stick position]].
    // The decoder reads the receive rule's WHEN result inline and returns the
    // whole position, which fills the steer bridge's single Position slot.
    const chassis = BrainDef.emptyBrainDef(env.brainServices, "chassis stage 2");
    const steerRule = chassis.pages().get(0)!.children().get(0)!;
    steerRule.when().appendTile(hostTile(env, mkSensorTileId(RADIO_RECEIVE_BUFFER)));
    steerRule.do().appendTile(userTile("cutebot steer"));
    steerRule.do().appendTile(userTile("decoded stick position"));

    // Stick forward-right: x = 50 (raw 226), y = 100 (raw 0).
    const stick: Step = { analog: { [VERTICAL_PIN]: 0, [HORIZONTAL_PIN]: 226 }, digital: { [PRESS_PIN]: 1 } };
    const wheels = runPair(env, gamepad, chassis, [stick, stick, stick]);
    // steer(x=50, y=100): drive(100) + turn(50) = (150, 100) -> scale 100/150 -> (100, 67).
    assert.deepEqual(decodeWheels(wheels.get(2)!), [100, 67], "the full loop drives the exact steered wheels");
  });
});
