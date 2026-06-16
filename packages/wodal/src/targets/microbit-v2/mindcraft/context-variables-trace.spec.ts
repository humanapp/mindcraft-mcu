/**
 * Golden observable trace for a hand-authored brain that exercises the by-name
 * context-variable host functions: ctx.brain.getVariable/setVariable (slot
 * backed) and ctx.rule.getVariable/setVariable (per-rule stores with
 * ancestor-chain inheritance on read). One root rule sets and reads a brain
 * variable, sets and reads its own rule variable, calls a sync action that
 * reads and writes rule variables through the calling rule's store, and calls a
 * child rule that reads an inherited rule variable from its parent. Misses
 * (an undeclared brain name and an unwritten rule name) read nil. Every read is
 * surfaced through a display set-pixel so it crosses the observable host
 * surface: a hit rides in the brightness arg as a number, a miss as nil. The
 * serialized binary and its rendered trace are pinned beside this spec as the
 * cross-VM conformance fixture: the C++ VM parity test
 * (cpp/test/trace-parity.test.cpp) loads the same binary and byte-compares.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  CoreFuncId,
  type LinkedBrainProgramJson,
  linkedBrainProgramFromJson,
  Op,
  type VmEvents,
} from "@mindcraft-lang/core/runtime";
import { getWodalDeviceProfile, WodalDeviceProfileId } from "../../../mindcraft/device-profile";
import { parseWodalProgramImageBytes, serializeWodalProgramImageBytes } from "../../../mindcraft/program-image-binary";
import { MicroBit } from "../microbit";
import { createMicroBitV2Environment } from "./environment";
import { ObservableTraceWriter } from "./observable-trace";
import { WodalMicroBitRuntime } from "./runtime";
import { MicroBitV2HostActions } from "./tile-ids";

const BIN_PATH = fileURLToPath(new URL("./__fixtures__/context-variables.mcprogram.bin", import.meta.url));
const TRACE_PATH = fileURLToPath(new URL("./__fixtures__/context-variables.ticks.trace", import.meta.url));

const DISPLAY_SET_PIXEL = MicroBitV2HostActions.DisplaySetPixel.actionId;

// Number constant-pool indices.
const N0 = 0;
const N_BX = 1; // brain "bx" value (11)
const N_RSHARED = 2; // rule "rshared" value (22)
const N_FROM_RULE = 3; // rule "fromRule" value (33)
const N_FROM_ACTION = 4; // rule "fromAction" value (44)
const N_CHILD_ONLY = 5; // rule "childOnly" value (55)

// String constant-pool indices (the variable names).
const S_BX = 0;
const S_BMISS = 1;
const S_RSHARED = 2;
const S_RMISS = 3;
const S_FROM_RULE = 4;
const S_FROM_ACTION = 5;
const S_CHILD_ONLY = 6;

// Value constant-pool index of the nil placeholder (the ignored struct receiver
// at arg 0 and the functions' return value).
const NIL = 0;

/** Writes a brain variable: brain.setVariable(name, numbers[numIdx]). */
function brainSet(nameIdx: number, numIdx: number) {
  return [
    { op: Op.PUSH_CONST_VAL, a: NIL }, // receiver (ignored)
    { op: Op.PUSH_CONST_STR, a: nameIdx },
    { op: Op.PUSH_CONST_NUM, a: numIdx },
    { op: Op.HOST_CALL, a: CoreFuncId.BrainContextSetVariable, b: 3, c: 0 },
    { op: Op.POP },
  ];
}

/** Writes a rule variable: rule.setVariable(name, numbers[numIdx]). */
function ruleSet(nameIdx: number, numIdx: number) {
  return [
    { op: Op.PUSH_CONST_VAL, a: NIL }, // receiver (ignored)
    { op: Op.PUSH_CONST_STR, a: nameIdx },
    { op: Op.PUSH_CONST_NUM, a: numIdx },
    { op: Op.HOST_CALL, a: CoreFuncId.RuleContextSetVariable, b: 3, c: 0 },
    { op: Op.POP },
  ];
}

/**
 * Surfaces a read value as set-pixel brightness: pushes x=0, y=0, then the
 * read pushed by `getFuncId`, then dispatches set-pixel.
 */
function surfaceRead(getFuncId: number, nameIdx: number) {
  return [
    { op: Op.PUSH_CONST_NUM, a: N0 }, // x
    { op: Op.PUSH_CONST_NUM, a: N0 }, // y
    { op: Op.PUSH_CONST_VAL, a: NIL }, // receiver (ignored)
    { op: Op.PUSH_CONST_STR, a: nameIdx },
    { op: Op.HOST_CALL, a: getFuncId, b: 2, c: 0 }, // brightness = read value
    { op: Op.HOST_ACTION_CALL, a: DISPLAY_SET_PIXEL, b: 3, c: 0 },
    { op: Op.POP },
  ];
}

const surfaceBrainGet = (nameIdx: number) => surfaceRead(CoreFuncId.BrainContextGetVariable, nameIdx);
const surfaceRuleGet = (nameIdx: number) => surfaceRead(CoreFuncId.RuleContextGetVariable, nameIdx);

/**
 * A root rule (funcId 0), one sync action (funcId 2), and a child rule (funcId
 * 1) whose ancestor is the root rule. The root rule round-trips a brain
 * variable and a rule variable (plus a miss of each), seeds "fromRule", calls
 * the action (which reads "fromRule" and writes "fromAction" through the
 * calling rule), reads "fromAction" back, then calls the child rule (which
 * reads the inherited "rshared" and writes its own "childOnly"), and finally
 * confirms the child's write did not propagate to the parent.
 */
function buildContextVariableBrainJson(): LinkedBrainProgramJson {
  const action = [
    ...surfaceRuleGet(S_FROM_RULE), // inherited from the calling rule -> 33
    ...ruleSet(S_FROM_ACTION, N_FROM_ACTION), // writes the calling rule's store
    { op: Op.PUSH_CONST_VAL, a: NIL },
    { op: Op.RET },
  ];

  const childRule = [
    ...surfaceRuleGet(S_RSHARED), // inherited from the parent rule -> 22
    ...ruleSet(S_CHILD_ONLY, N_CHILD_ONLY), // child's own store only
    { op: Op.PUSH_CONST_VAL, a: NIL },
    { op: Op.RET },
  ];

  const rootRule = [
    ...brainSet(S_BX, N_BX),
    ...surfaceBrainGet(S_BX), // round-trip -> 11
    ...surfaceBrainGet(S_BMISS), // undeclared brain name -> nil

    ...ruleSet(S_RSHARED, N_RSHARED),
    ...surfaceRuleGet(S_RSHARED), // round-trip -> 22
    ...surfaceRuleGet(S_RMISS), // unwritten rule name -> nil

    ...ruleSet(S_FROM_RULE, N_FROM_RULE),
    { op: Op.ACTION_CALL, a: 0, b: 0, c: 1 },
    { op: Op.POP },
    ...surfaceRuleGet(S_FROM_ACTION), // action wrote the calling rule's store -> 44

    { op: Op.CALL, a: 1, b: 0 },
    { op: Op.POP },
    ...surfaceRuleGet(S_CHILD_ONLY), // child write did not propagate -> nil

    { op: Op.PUSH_CONST_VAL, a: NIL },
    { op: Op.RET },
  ];

  return {
    program: {
      version: 1,
      functions: [
        { code: rootRule, numParams: 0, numLocals: 0 },
        { code: childRule, numParams: 0, numLocals: 0 },
        { code: action, numParams: 0, numLocals: 0 },
      ],
      constantPools: {
        numbers: [0, 11, 22, 33, 44, 55],
        strings: ["bx", "bmiss", "rshared", "rmiss", "fromRule", "fromAction", "childOnly"],
        values: [{ t: 1 }],
      },
      types: [],
      variableNames: ["bx"],
      entryPoint: 0,
      actions: [{ entryFuncId: 2 }],
      ruleFuncIds: [0, 1],
      ruleAncestors: [{ ruleFuncId: 1, parentRuleFuncId: 0 }],
    },
    pages: [
      {
        pageIndex: 0,
        pageId: "context-variables-page",
        pageName: "Context Variables",
        rootRuleFuncIds: [0],
        actionCallSites: [
          { binding: "host", callSiteId: 0, actionId: DISPLAY_SET_PIXEL },
          { binding: "bytecode", callSiteId: 1, actionSlot: 0 },
        ],
      },
    ],
  };
}

/** Serializes the hand-authored brain to its binary `.mcprogram` payload. */
function serializeContextVariableBrainBytes(): Uint8Array {
  const environment = createMicroBitV2Environment();
  const profile = getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2);
  const linked = linkedBrainProgramFromJson(buildContextVariableBrainJson());
  const image = profile.createProgramImage(linked);
  return serializeWodalProgramImageBytes(image, environment.brainServices.runtime.types);
}

/** Runs the committed binary over a fixed tick schedule with the trace taps installed. */
function runContextVariableTrace(bin: Uint8Array): string {
  const environment = createMicroBitV2Environment();
  const profile = getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2);
  const decoded = parseWodalProgramImageBytes(
    bin,
    WodalDeviceProfileId.MICROBIT_V2,
    environment.brainServices.runtime.types
  );
  const writer = new ObservableTraceWriter({
    profileId: profile.numericProfileId,
    precision: profile.numberPrecision,
  });

  const action = environment.brainServices.runtime.actions.getById(DISPLAY_SET_PIXEL);
  assert.ok(action !== undefined && action.binding === "host");
  const exec = action.execSync;
  assert.ok(exec !== undefined);
  action.execSync = (ctx, args) => {
    const result = exec(ctx, args);
    const callSiteId = ctx.currentCallSiteId;
    assert.ok(callSiteId !== undefined);
    writer.hostActionCall(DISPLAY_SET_PIXEL, callSiteId, args, result);
    return result;
  };

  const microbit = new MicroBit();
  const deviceSetPixelValue = microbit.display.setPixelValue.bind(microbit.display);
  microbit.display.setPixelValue = (x, y, brightness) => {
    writer.displaySetPixel(x, y, brightness);
    deviceSetPixelValue(x, y, brightness);
  };

  const vmEvents: VmEvents = {
    onFiberFault: (payload) => writer.fiberFault(payload.fiberId, payload.err.code),
  };
  const runtime = new WodalMicroBitRuntime({ environment, microbit, vmEvents });
  assert.deepEqual(runtime.loadWodalProgramImage(profile.createProgramImage(decoded.program)), { ok: true });

  let lastThinkTimeMs = 0;
  for (let i = 0; i < 3; i++) {
    const timeMs = lastThinkTimeMs + 16;
    writer.tick(i + 1, timeMs, lastThinkTimeMs === 0 ? 0 : timeMs - lastThinkTimeMs);
    runtime.tick(16);
    lastThinkTimeMs = timeMs;
  }
  return writer.render();
}

test("the committed context-variables binary and observable trace golden are byte-stable", () => {
  if (!existsSync(BIN_PATH)) {
    writeFileSync(BIN_PATH, serializeContextVariableBrainBytes());
  }
  const bin = new Uint8Array(readFileSync(BIN_PATH));
  assert.deepEqual(bin, serializeContextVariableBrainBytes(), "context-variables.mcprogram.bin is not byte-stable");

  const first = runContextVariableTrace(bin);
  const second = runContextVariableTrace(bin);
  assert.equal(second, first, "two fresh runs must render byte-identical traces");

  const lines = first.split("\n");
  assert.equal(lines.filter((line) => line.startsWith("tick ")).length, 3);
  // Eight reads are surfaced per tick (brain hit + brain miss, rule hit + rule
  // miss, the action's inherited read, the read-back of the action's write, the
  // child's inherited read, and the non-propagated child write), run thrice,
  // with no faults.
  assert.equal(lines.filter((line) => line.startsWith("action 401 ")).length, 24);
  assert.equal(lines.filter((line) => line.startsWith("port display set-pixel ")).length, 24);
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);

  if (!existsSync(TRACE_PATH)) {
    writeFileSync(TRACE_PATH, first);
  }
  assert.equal(readFileSync(TRACE_PATH, "utf8"), first, "context-variables.ticks.trace is not byte-stable");
});
