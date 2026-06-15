/**
 * Cap-reconciliation conformance: the microbit-v2 oracle must fault
 * `StackOverflow` at the device per-fiber caps (stack 256, locals 256, frames
 * 64, handlers 16), not the VM's large defaults (4096 / 4096 / 256 / 64). Each
 * brain here overflows a device cap while staying *under* the corresponding
 * default, so it faults only because the device caps are threaded into the
 * oracle's VmConfig - and otherwise would run to completion. This pins the
 * oracle to the same fault points the C++ VM enforces via its kMax* guards
 * (cpp/test/control-flow.test.cpp), so both sides fault at the same depth.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ErrorCode,
  type LinkedBrainProgramJson,
  linkedBrainProgramFromJson,
  Op,
  type VmEvents,
} from "@mindcraft-lang/core/runtime";
import { getWodalDeviceProfile, WodalDeviceProfileId } from "../../../mindcraft/device-profile";
import { MicroBit } from "../microbit";
import { createMicroBitV2Environment } from "./environment";
import { WodalMicroBitRuntime } from "./runtime";

type Instr = { op: Op; a?: number; b?: number; c?: number };
type Func = { code: Instr[]; numParams: number; numLocals: number };

/** Wraps `functions` as a single root-rule brain over one page (no host actions). */
function ruleBrain(functions: Func[]): LinkedBrainProgramJson {
  return {
    program: {
      version: 1,
      functions,
      constantPools: { numbers: [0], strings: [], values: [{ t: 1 }] },
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
        pageId: "overflow-page",
        pageName: "Overflow",
        rootRuleFuncIds: [0],
        actionCallSites: [],
      },
    ],
  };
}

/** Loads `brain` and runs one tick, returning the fault codes the VM raised. */
function runOnce(brain: LinkedBrainProgramJson): ErrorCode[] {
  const environment = createMicroBitV2Environment();
  const profile = getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2);
  const faults: ErrorCode[] = [];
  const vmEvents: VmEvents = {
    onFiberFault: (payload) => faults.push(payload.err.code),
  };
  const runtime = new WodalMicroBitRuntime({ environment, microbit: new MicroBit(), vmEvents });
  const linked = linkedBrainProgramFromJson(brain);
  assert.deepEqual(runtime.loadWodalProgramImage(profile.createProgramImage(linked)), { ok: true });
  runtime.tick(16);
  return faults;
}

/** A chain f0 -> f1 -> ... -> f(n-1); each callee returns 0 so it completes under the defaults. */
function callChain(n: number, numLocals: number): Func[] {
  const functions = [];
  for (let i = 0; i < n; i++) {
    const code: Instr[] =
      i < n - 1
        ? [{ op: Op.CALL, a: i + 1, b: 0 }, { op: Op.RET }]
        : [{ op: Op.PUSH_CONST_NUM, a: 0 }, { op: Op.RET }];
    functions.push({ code, numParams: 0, numLocals });
  }
  return functions;
}

test("the oracle faults StackOverflow at the device operand-stack cap (256, under the 4096 default)", () => {
  // 300 pushes: faults at 257 under the device cap; would complete under 4096.
  const code: Instr[] = [];
  for (let i = 0; i < 300; i++) {
    code.push({ op: Op.PUSH_CONST_NUM, a: 0 });
  }
  code.push({ op: Op.RET });
  const faults = runOnce(ruleBrain([{ code, numParams: 0, numLocals: 0 }]));
  assert.deepEqual(faults, [ErrorCode.StackOverflow]);
});

test("the oracle faults StackOverflow at the device locals cap (256, with no default bound)", () => {
  // 60 frames x 5 locals = 300 total: crosses 256 around frame 52, well under
  // the 64 frame cap, so the locals cap is what faults.
  const faults = runOnce(ruleBrain(callChain(60, 5)));
  assert.deepEqual(faults, [ErrorCode.StackOverflow]);
});

test("the oracle faults StackOverflow at the device frame cap (64, under the 256 default)", () => {
  // 65-deep call chain: faults pushing frame 65 under the device cap; would
  // complete under the 256 default.
  const faults = runOnce(ruleBrain(callChain(65, 0)));
  assert.deepEqual(faults, [ErrorCode.StackOverflow]);
});

test("the oracle faults StackOverflow at the device handler cap (16, under the 64 default)", () => {
  // 17 TRY pushes without popping: faults at the 17th under the device cap;
  // would run to RET under the 64 default.
  const code: Instr[] = [];
  for (let i = 0; i < 17; i++) {
    code.push({ op: Op.TRY, a: 1 });
  }
  code.push({ op: Op.RET });
  const faults = runOnce(ruleBrain([{ code, numParams: 0, numLocals: 0 }]));
  assert.deepEqual(faults, [ErrorCode.StackOverflow]);
});
