/**
 * Golden observable trace for a hand-authored brain that exercises rule-variable
 * inheritance across a plain function call: a root rule seeds a rule variable,
 * calls a non-rule helper function, and the helper reads that variable and
 * writes a second one through the calling rule's store. The rule then reads the
 * helper's write back. Both the helper's inherited read and the rule's read-back
 * are surfaced through a display set-pixel so they cross the observable host
 * surface as the brightness arg. A VM that does not forward the calling rule
 * into the helper frame would read nil and no-op the write, diverging on both
 * surfaced values. The serialized binary and its rendered trace are pinned
 * beside this spec as the cross-VM conformance fixture: the C++ VM parity test
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

const BIN_PATH = fileURLToPath(new URL("./__fixtures__/rule-helper-variables.mcprogram.bin", import.meta.url));
const TRACE_PATH = fileURLToPath(new URL("./__fixtures__/rule-helper-variables.ticks.trace", import.meta.url));

const DISPLAY_SET_PIXEL = MicroBitV2HostActions.DisplaySetPixel.actionId;

// Number constant-pool indices.
const N0 = 0;
const N_SEED = 1; // rule "seed" value (77)
const N_FROM_HELPER = 2; // rule "fromHelper" value (88)

// String constant-pool indices (the variable names).
const S_SEED = 0;
const S_FROM_HELPER = 1;

// Value constant-pool index of the nil placeholder (the ignored struct receiver
// at arg 0 and the functions' return value).
const NIL = 0;

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
 * Surfaces a rule-variable read as set-pixel brightness: pushes x=0, y=0, then
 * the read pushed by rule.getVariable(name), then dispatches set-pixel.
 */
function surfaceRuleGet(nameIdx: number) {
  return [
    { op: Op.PUSH_CONST_NUM, a: N0 }, // x
    { op: Op.PUSH_CONST_NUM, a: N0 }, // y
    { op: Op.PUSH_CONST_VAL, a: NIL }, // receiver (ignored)
    { op: Op.PUSH_CONST_STR, a: nameIdx },
    { op: Op.HOST_CALL, a: CoreFuncId.RuleContextGetVariable, b: 2, c: 0 }, // brightness = read value
    { op: Op.HOST_ACTION_CALL, a: DISPLAY_SET_PIXEL, b: 3, c: 0 },
    { op: Op.POP },
  ];
}

/**
 * A root rule (funcId 0) and a plain helper (funcId 1, not a rule). The root
 * rule seeds "seed", calls the helper, and reads "fromHelper" back. The helper
 * reads the inherited "seed" and writes "fromHelper", both through the calling
 * rule's store: it carries no rule of its own, so it resolves the rule from the
 * frame that called it.
 */
function buildRuleHelperBrainJson(): LinkedBrainProgramJson {
  const helper = [
    ...surfaceRuleGet(S_SEED), // inherited from the calling rule -> 77
    ...ruleSet(S_FROM_HELPER, N_FROM_HELPER), // writes the calling rule's store
    { op: Op.PUSH_CONST_VAL, a: NIL },
    { op: Op.RET },
  ];

  const rootRule = [
    ...ruleSet(S_SEED, N_SEED),
    { op: Op.CALL, a: 1, b: 0 },
    { op: Op.POP },
    ...surfaceRuleGet(S_FROM_HELPER), // helper wrote the calling rule's store -> 88

    { op: Op.PUSH_CONST_VAL, a: NIL },
    { op: Op.RET },
  ];

  return {
    program: {
      version: 1,
      functions: [
        { code: rootRule, numParams: 0, numLocals: 0 },
        { code: helper, numParams: 0, numLocals: 0 },
      ],
      constantPools: {
        numbers: [0, 77, 88],
        strings: ["seed", "fromHelper"],
        values: [{ t: 1 }],
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
        pageId: "rule-helper-variables-page",
        pageName: "Rule Helper Variables",
        rootRuleFuncIds: [0],
        actionCallSites: [{ binding: "host", callSiteId: 0, actionId: DISPLAY_SET_PIXEL }],
      },
    ],
  };
}

/** Serializes the hand-authored brain to its binary `.mcprogram` payload. */
function serializeRuleHelperBrainBytes(): Uint8Array {
  const environment = createMicroBitV2Environment();
  const profile = getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2);
  const linked = linkedBrainProgramFromJson(buildRuleHelperBrainJson());
  const image = profile.createProgramImage(linked);
  return serializeWodalProgramImageBytes(image, environment.brainServices.runtime.types);
}

/** Runs the committed binary over a fixed tick schedule with the trace taps installed. */
function runRuleHelperTrace(bin: Uint8Array): string {
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

test("the committed rule-helper-variables binary and observable trace golden are byte-stable", () => {
  if (!existsSync(BIN_PATH)) {
    writeFileSync(BIN_PATH, serializeRuleHelperBrainBytes());
  }
  const bin = new Uint8Array(readFileSync(BIN_PATH));
  assert.deepEqual(bin, serializeRuleHelperBrainBytes(), "rule-helper-variables.mcprogram.bin is not byte-stable");

  const first = runRuleHelperTrace(bin);
  const second = runRuleHelperTrace(bin);
  assert.equal(second, first, "two fresh runs must render byte-identical traces");

  const lines = first.split("\n");
  assert.equal(lines.filter((line) => line.startsWith("tick ")).length, 3);
  // Two reads are surfaced per tick (the helper's inherited "seed" read and the
  // rule's read-back of the helper's "fromHelper" write), run thrice, no faults.
  assert.equal(lines.filter((line) => line.startsWith("port display set-pixel ")).length, 6);
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);

  if (!existsSync(TRACE_PATH)) {
    writeFileSync(TRACE_PATH, first);
  }
  assert.equal(readFileSync(TRACE_PATH, "utf8"), first, "rule-helper-variables.ticks.trace is not byte-stable");
});
