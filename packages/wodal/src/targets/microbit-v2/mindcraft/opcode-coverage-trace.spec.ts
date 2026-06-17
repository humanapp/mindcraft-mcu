/**
 * Golden observable trace for a conformance brain that exercises the bytecode
 * opcodes no other behavioral golden reaches: DUP, SWAP, STACK_SET_REL,
 * unconditional JMP, JMP_IF_TRUE, END_TRY (a try block that exits normally), and
 * the in-place list operations LIST_SET, LIST_INSERT, LIST_REMOVE, LIST_SHIFT,
 * and LIST_SWAP. The rule builds a list, mutates it through those operations, and
 * lights a pixel whose coordinates and brightness read back the final list state,
 * so the trace proves the operations produced the same result on both VMs.
 *
 * The serialized binary and rendered trace are pinned beside this spec as the
 * cross-VM conformance fixtures: the C++ VM parity test
 * (cpp/test/trace-parity.test.cpp) loads the same binary and byte-compares.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { MindcraftEnvironment } from "@mindcraft-lang/core/app";
import {
  BrainRuntime,
  type LinkedBrainProgramJson,
  linkedBrainProgramFromJson,
  Op,
  type PlatformServices,
  type VmEvents,
} from "@mindcraft-lang/core/runtime";
import { getWodalDeviceProfile, WodalDeviceProfileId } from "../../../mindcraft/device-profile";
import { parseWodalProgramImageBytes, serializeWodalProgramImageBytes } from "../../../mindcraft/program-image-binary";
import { MicroBit } from "../microbit";
import { createMicroBitV2Environment } from "./environment";
import { ObservableTraceWriter } from "./observable-trace";
import { MicroBitV2HostActions } from "./tile-ids";

const SET_PIXEL = MicroBitV2HostActions.DisplaySetPixel.actionId;

const BIN_PATH = fileURLToPath(new URL("./__fixtures__/opcode-coverage.mcprogram.bin", import.meta.url));
const TRACE_PATH = fileURLToPath(new URL("./__fixtures__/opcode-coverage.ticks.trace", import.meta.url));

// Number constant-pool indices.
const N0 = 0;
const N1 = 1;
const N2 = 2;
const N7 = 3;
const N255 = 4;

/**
 * A single-page brain whose rule exercises the otherwise-uncovered opcodes and
 * ends by writing pixel (list[0], list.length, 255). After the mutations the
 * list holds a single element 1, so the rule lights pixel (1, 1).
 */
function buildOpcodeCoverageBrainJson(): LinkedBrainProgramJson {
  const rule = [
    { op: Op.LIST_NEW, a: 0 }, // 0: [L] (a reserved)
    { op: Op.STORE_VAR_SLOT, a: 0 }, // 1: var0 = L ([])
    { op: Op.LOAD_VAR_SLOT, a: 0 }, // 2
    { op: Op.PUSH_CONST_NUM, a: N7 }, // 3
    { op: Op.LIST_PUSH }, // 4: L = [7]
    { op: Op.POP }, // 5
    { op: Op.LOAD_VAR_SLOT, a: 0 }, // 6
    { op: Op.PUSH_CONST_NUM, a: N7 }, // 7
    { op: Op.LIST_PUSH }, // 8: L = [7, 7]
    { op: Op.POP }, // 9
    { op: Op.LOAD_VAR_SLOT, a: 0 }, // 10
    { op: Op.DUP }, // 11: [L, L]
    { op: Op.POP }, // 12: [L]
    { op: Op.PUSH_CONST_NUM, a: N0 }, // 13: [L, 0]
    { op: Op.SWAP }, // 14: [0, L]
    { op: Op.POP }, // 15: [0]
    { op: Op.POP }, // 16: []
    { op: Op.LOAD_VAR_SLOT, a: 0 }, // 17: [L]
    { op: Op.PUSH_CONST_NUM, a: N0 }, // 18: index 0
    { op: Op.PUSH_CONST_NUM, a: N1 }, // 19: value 1
    { op: Op.LIST_SET }, // 20: L = [1, 7]
    { op: Op.POP }, // 21
    { op: Op.LOAD_VAR_SLOT, a: 0 }, // 22: [L]
    { op: Op.PUSH_CONST_NUM, a: N1 }, // 23: index 1
    { op: Op.PUSH_CONST_NUM, a: N2 }, // 24: value 2
    { op: Op.LIST_INSERT }, // 25: L = [1, 2, 7]
    { op: Op.LOAD_VAR_SLOT, a: 0 }, // 26: [L]
    { op: Op.PUSH_CONST_NUM, a: N0 }, // 27: i 0
    { op: Op.PUSH_CONST_NUM, a: N2 }, // 28: j 2
    { op: Op.LIST_SWAP }, // 29: L = [7, 2, 1]
    { op: Op.LOAD_VAR_SLOT, a: 0 }, // 30: [L]
    { op: Op.PUSH_CONST_NUM, a: N1 }, // 31: index 1
    { op: Op.LIST_REMOVE }, // 32: [removed=2]; L = [7, 1]
    { op: Op.POP }, // 33
    { op: Op.LOAD_VAR_SLOT, a: 0 }, // 34: [L]
    { op: Op.LIST_SHIFT }, // 35: [removed=7]; L = [1]
    { op: Op.POP }, // 36
    { op: Op.PUSH_CONST_NUM, a: N0 }, // 37: [0]
    { op: Op.PUSH_CONST_NUM, a: N0 }, // 38: [0, 0]
    { op: Op.PUSH_CONST_NUM, a: N1 }, // 39: [0, 0, 1]
    { op: Op.STACK_SET_REL, a: 1 }, // 40: [1, 0]
    { op: Op.POP }, // 41: [1]
    { op: Op.POP }, // 42: []
    { op: Op.JMP, a: 2 }, // 43: skip 44
    { op: Op.POP }, // 44: dead
    { op: Op.PUSH_CONST_NUM, a: N1 }, // 45: [1] (truthy)
    { op: Op.JMP_IF_TRUE, a: 2 }, // 46: taken -> skip 47
    { op: Op.POP }, // 47: dead
    { op: Op.TRY, a: 2 }, // 48: catch target 50
    { op: Op.END_TRY }, // 49: try block exits normally
    { op: Op.LOAD_VAR_SLOT, a: 0 }, // 50: [L]
    { op: Op.PUSH_CONST_NUM, a: N0 }, // 51: index 0
    { op: Op.LIST_GET }, // 52: [list[0] = 1]
    { op: Op.LOAD_VAR_SLOT, a: 0 }, // 53: [1, L]
    { op: Op.LIST_LEN }, // 54: [1, 1]
    { op: Op.PUSH_CONST_NUM, a: N255 }, // 55: [1, 1, 255]
    { op: Op.HOST_ACTION_CALL, a: SET_PIXEL, b: 3, c: 0 }, // 56: pixel (1, 1, 255)
    { op: Op.POP }, // 57
    { op: Op.PUSH_CONST_VAL, a: 0 }, // 58
    { op: Op.RET }, // 59
  ];

  return {
    program: {
      version: 1,
      functions: [{ code: rule, numParams: 0, numLocals: 0 }],
      constantPools: { numbers: [0, 1, 2, 7, 255], strings: [], values: [{ t: 1 }] },
      types: [],
      variableNames: ["items"],
      entryPoint: 0,
      actions: [],
      ruleFuncIds: [0],
      ruleAncestors: [],
    },
    pages: [
      {
        pageIndex: 0,
        pageId: "opcode-coverage-page",
        pageName: "Opcode Coverage Page",
        rootRuleFuncIds: [0],
        actionCallSites: [{ binding: "host", callSiteId: 0, actionId: SET_PIXEL }],
      },
    ],
  };
}

function serializeBrainBytes(json: LinkedBrainProgramJson): Uint8Array {
  const environment = createMicroBitV2Environment();
  const profile = getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2);
  const linked = linkedBrainProgramFromJson(json);
  const image = profile.createProgramImage(linked);
  return serializeWodalProgramImageBytes(image, environment.brainServices.runtime.types);
}

function hostServicesOf(environment: MindcraftEnvironment): Omit<PlatformServices, "brain"> {
  const { runtime, shared, app } = environment.brainServices;
  return { runtime, shared, app };
}

/** Runs `bin` for one 600ms think, tapping the set-pixel action and device port. */
function runTrace(bin: Uint8Array): { trace: string; microbit: MicroBit } {
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

  const actions = environment.brainServices.runtime.actions;
  const action = actions.getById(SET_PIXEL);
  assert.ok(action !== undefined && action.binding === "host");
  const exec = action.execSync;
  assert.ok(exec !== undefined);
  action.execSync = (ctx, args) => {
    const result = exec(ctx, args);
    const callSiteId = ctx.currentCallSiteId;
    assert.ok(callSiteId !== undefined);
    writer.hostActionCall(SET_PIXEL, callSiteId, args, result);
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

  const linked = decoded.program;
  const brain = new BrainRuntime(
    linked.program,
    linked.pages,
    hostServicesOf(environment),
    { microbit },
    undefined,
    vmEvents,
    {
      defaultBudget: profile.defaultBudget,
      hookBudget: profile.hookBudget,
      maxFibers: profile.maxFibers,
      maxStackSize: profile.maxStackSize,
      maxLocalsSize: profile.maxLocalsSize,
      maxFrameDepth: profile.maxFrameDepth,
      maxHandlers: profile.maxHandlers,
    }
  );
  brain.startup();

  writer.tick(1, 600, 0);
  brain.think(600);
  return { trace: writer.render(), microbit };
}

test("the committed opcode-coverage binary and observable trace golden are byte-stable", () => {
  if (!existsSync(BIN_PATH)) {
    writeFileSync(BIN_PATH, serializeBrainBytes(buildOpcodeCoverageBrainJson()));
  }
  const bin = new Uint8Array(readFileSync(BIN_PATH));
  assert.deepEqual(
    bin,
    serializeBrainBytes(buildOpcodeCoverageBrainJson()),
    "opcode-coverage.mcprogram.bin is not byte-stable"
  );

  const first = runTrace(bin);
  const second = runTrace(bin);
  assert.equal(second.trace, first.trace, "two fresh runs must render byte-identical traces");

  const lines = first.trace.split("\n");
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);
  assert.equal(lines.filter((line) => line.startsWith("port display set-pixel ")).length, 1);
  // The mutations leave list = [1], so the rule lights pixel (1, 1).
  assert.equal(first.microbit.display.getPixelValue(1, 1), 255);

  if (!existsSync(TRACE_PATH)) {
    writeFileSync(TRACE_PATH, first.trace);
  }
  assert.equal(readFileSync(TRACE_PATH, "utf8"), first.trace, "opcode-coverage.ticks.trace is not byte-stable");
});
