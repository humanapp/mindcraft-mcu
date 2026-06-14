/**
 * Golden observable trace for a hand-authored struct/closure brain. The brain
 * builds a closed struct, exercises the id-based field opcodes plus the
 * value-semantics deep-copy sites (STRUCT_DEEP_COPY, STORE_VAR_SLOT), the
 * name-keyed fallback opcodes (which degrade on the de-stringed binary path),
 * INSTANCE_OF, a direct CALL, and closures (MAKE_CLOSURE / LOAD_CAPTURE /
 * CALL_INDIRECT / CALL_INDIRECT_ARGS). Each computed value crosses the
 * observable host-binding surface as a display set-pixel arg. The serialized
 * binary and its rendered trace are pinned beside this spec as the cross-VM
 * struct/closure conformance fixture: the C++ VM parity test
 * (cpp/test/trace-parity.test.cpp) loads the same binary and byte-compares.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
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

const BIN_PATH = fileURLToPath(new URL("./__fixtures__/struct-closure.mcprogram.bin", import.meta.url));
const TRACE_PATH = fileURLToPath(new URL("./__fixtures__/struct-closure.ticks.trace", import.meta.url));

const DISPLAY_SET_PIXEL = MicroBitV2HostActions.DisplaySetPixel.actionId;

// Number constant-pool indices.
const N3 = 0;
const N4 = 1;
const N255 = 2;
const N9 = 3;
const N5 = 4;
const N7 = 5;
const N2 = 6;
const N8 = 7;
const N42 = 8;

/**
 * One root-rule function plus three callees. The rule builds a `Point` struct,
 * reads its fields back by id, deep-copies it two ways (the explicit opcode and
 * STORE_VAR_SLOT) to confirm value semantics, runs the name-keyed fallback
 * opcodes (which degrade to nil / no-op on the binary path), checks
 * INSTANCE_OF, calls a helper directly, and builds and calls a closure. Each
 * surfaced scalar is dispatched through display set-pixel so it crosses the
 * observable surface.
 */
function buildStructClosureBrainJson(): LinkedBrainProgramJson {
  const setPixel = { op: Op.HOST_ACTION_CALL, a: DISPLAY_SET_PIXEL, b: 3, c: 0 };

  // func 0: the root rule (locals: 0 = working struct, 1 = deep copy, 2 = closure)
  const rule = [
    // --- struct new / set (pure store) / get ---
    { op: Op.STRUCT_NEW, a: 0, b: 0 }, // [p] typed Point (slotCount 2)
    { op: Op.STORE_LOCAL, a: 0 },
    { op: Op.LOAD_LOCAL, a: 0 },
    { op: Op.PUSH_CONST_NUM, a: N3 },
    { op: Op.STRUCT_SET_FIELD, a: 0 },
    { op: Op.POP },
    { op: Op.LOAD_LOCAL, a: 0 },
    { op: Op.PUSH_CONST_NUM, a: N4 },
    { op: Op.STRUCT_SET_FIELD, a: 1 },
    { op: Op.POP },
    // surface: setPixel(p.0 = 3, p.1 = 4, p instanceof Point = true)
    { op: Op.LOAD_LOCAL, a: 0 },
    { op: Op.STRUCT_GET_FIELD, a: 0 },
    { op: Op.LOAD_LOCAL, a: 0 },
    { op: Op.STRUCT_GET_FIELD, a: 1 },
    { op: Op.LOAD_LOCAL, a: 0 },
    { op: Op.INSTANCE_OF, a: 0 },
    setPixel,
    { op: Op.POP },

    // --- explicit deep copy breaks struct aliasing ---
    { op: Op.LOAD_LOCAL, a: 0 },
    { op: Op.STRUCT_DEEP_COPY },
    { op: Op.STORE_LOCAL, a: 1 }, // q = copy of p
    { op: Op.LOAD_LOCAL, a: 0 },
    { op: Op.PUSH_CONST_NUM, a: N9 },
    { op: Op.STRUCT_SET_FIELD, a: 0 },
    { op: Op.POP }, // p.0 = 9
    // surface: setPixel(q.0 = 3 unchanged, p.0 = 9, (number) instanceof Point = false)
    { op: Op.LOAD_LOCAL, a: 1 },
    { op: Op.STRUCT_GET_FIELD, a: 0 },
    { op: Op.LOAD_LOCAL, a: 0 },
    { op: Op.STRUCT_GET_FIELD, a: 0 },
    { op: Op.PUSH_CONST_NUM, a: N2 },
    { op: Op.INSTANCE_OF, a: 0 },
    setPixel,
    { op: Op.POP },

    // --- STORE_VAR_SLOT deep-copies on store ---
    { op: Op.LOAD_LOCAL, a: 0 },
    { op: Op.STORE_VAR_SLOT, a: 0 }, // saved = copy of p (.0 = 9)
    { op: Op.LOAD_LOCAL, a: 0 },
    { op: Op.PUSH_CONST_NUM, a: N5 },
    { op: Op.STRUCT_SET_FIELD, a: 0 },
    { op: Op.POP }, // p.0 = 5
    // surface: setPixel(saved.0 = 9 unchanged, p.0 = 5, 255)
    { op: Op.LOAD_VAR_SLOT, a: 0 },
    { op: Op.STRUCT_GET_FIELD, a: 0 },
    { op: Op.LOAD_LOCAL, a: 0 },
    { op: Op.STRUCT_GET_FIELD, a: 0 },
    { op: Op.PUSH_CONST_NUM, a: N255 },
    setPixel,
    { op: Op.POP },

    // --- name-keyed fallback degrades on the binary path ---
    { op: Op.LOAD_LOCAL, a: 0 },
    { op: Op.PUSH_CONST_STR, a: 0 },
    { op: Op.GET_FIELD }, // -> nil
    { op: Op.LOAD_LOCAL, a: 0 },
    { op: Op.PUSH_CONST_STR, a: 0 },
    { op: Op.PUSH_CONST_NUM, a: N8 },
    { op: Op.SET_FIELD },
    { op: Op.POP }, // no-op write
    // surface: setPixel(GET_FIELD = nil, p.0 = 5 unchanged by SET_FIELD, 255)
    { op: Op.LOAD_LOCAL, a: 0 },
    { op: Op.STRUCT_GET_FIELD, a: 0 },
    { op: Op.PUSH_CONST_NUM, a: N255 },
    setPixel,
    { op: Op.POP },

    // --- STRUCT_COPY_EXCEPT degrades to an all-nil struct of the operand type ---
    { op: Op.LOAD_LOCAL, a: 0 },
    { op: Op.PUSH_CONST_STR, a: 0 },
    { op: Op.STRUCT_COPY_EXCEPT, a: 1, b: 0 }, // [c]
    { op: Op.STRUCT_GET_FIELD, a: 0 }, // c.0 -> nil
    { op: Op.PUSH_CONST_NUM, a: N5 },
    { op: Op.PUSH_CONST_NUM, a: N255 },
    setPixel,
    { op: Op.POP },

    // --- direct CALL ---
    { op: Op.PUSH_CONST_NUM, a: N42 },
    { op: Op.CALL, a: 1, b: 1 }, // identity(42) -> 42
    { op: Op.PUSH_CONST_NUM, a: N3 },
    { op: Op.PUSH_CONST_NUM, a: N255 },
    setPixel,
    { op: Op.POP },

    // --- closure: capture, load capture, call indirect ---
    { op: Op.PUSH_CONST_NUM, a: N7 },
    { op: Op.MAKE_CLOSURE, a: 2, b: 1 },
    { op: Op.STORE_LOCAL, a: 2 }, // capture [7]
    { op: Op.LOAD_LOCAL, a: 2 },
    { op: Op.CALL_INDIRECT, a: 0 }, // -> 7
    { op: Op.PUSH_CONST_NUM, a: N4 },
    { op: Op.PUSH_CONST_NUM, a: N255 },
    setPixel,
    { op: Op.POP },

    // --- CALL_INDIRECT_ARGS truncates surplus args ---
    { op: Op.LOAD_LOCAL, a: 2 },
    { op: Op.PUSH_CONST_NUM, a: N3 },
    { op: Op.PUSH_CONST_NUM, a: N4 },
    { op: Op.CALL_INDIRECT_ARGS, a: 2 }, // closure takes 0 params; 2 args dropped -> capture 7
    { op: Op.PUSH_CONST_NUM, a: N5 },
    { op: Op.PUSH_CONST_NUM, a: N255 },
    setPixel,
    { op: Op.POP },

    // --- CALL_INDIRECT_ARGS nil-pads missing args ---
    { op: Op.MAKE_CLOSURE, a: 3, b: 0 },
    { op: Op.PUSH_CONST_NUM, a: N3 },
    { op: Op.CALL_INDIRECT_ARGS, a: 1 }, // func 3 takes 2 params; second padded nil and returned -> nil
    { op: Op.PUSH_CONST_NUM, a: N5 },
    { op: Op.PUSH_CONST_NUM, a: N255 },
    setPixel,
    { op: Op.POP },

    { op: Op.PUSH_CONST_VAL, a: 0 }, // void
    { op: Op.RET },
  ];

  // func 1: identity(x) -> x
  const identity = [{ op: Op.LOAD_LOCAL, a: 0 }, { op: Op.RET }];
  // func 2: closure body -> first capture
  const captureBody = [{ op: Op.LOAD_CAPTURE, a: 0 }, { op: Op.RET }];
  // func 3: second(a, b) -> b (exercises CALL_INDIRECT_ARGS nil padding)
  const second = [{ op: Op.LOAD_LOCAL, a: 1 }, { op: Op.RET }];

  return {
    program: {
      version: 1,
      functions: [
        { code: rule, numParams: 0, numLocals: 3 },
        { code: identity, numParams: 1, numLocals: 1 },
        { code: captureBody, numParams: 0, numLocals: 0 },
        { code: second, numParams: 2, numLocals: 2 },
      ],
      constantPools: {
        numbers: [3, 4, 255, 9, 5, 7, 2, 8, 42],
        strings: ["x"],
        values: [{ t: 1 }],
      },
      types: [{ tag: "struct", typeId: "struct:Point", name: "Point", maxFieldId: 1 }],
      variableNames: ["saved"],
      entryPoint: 0,
      actions: [],
      ruleFuncIds: [0],
      ruleAncestors: [],
    },
    pages: [
      {
        pageIndex: 0,
        pageId: "struct-closure-page",
        pageName: "Struct Closure",
        rootRuleFuncIds: [0],
        actionCallSites: [{ binding: "host", callSiteId: 0, actionId: DISPLAY_SET_PIXEL }],
      },
    ],
  };
}

/** Serializes the hand-authored brain to its binary `.mcprogram` payload. */
function serializeStructClosureBrainBytes(): Uint8Array {
  const environment = createMicroBitV2Environment();
  const profile = getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2);
  const linked = linkedBrainProgramFromJson(buildStructClosureBrainJson());
  const image = profile.createProgramImage(linked);
  return serializeWodalProgramImageBytes(image, environment.brainServices.runtime.types);
}

/** Runs the committed binary over a fixed tick schedule with the trace taps installed. */
function runStructClosureTrace(bin: Uint8Array): { trace: string; microbit: MicroBit } {
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
  return { trace: writer.render(), microbit };
}

test("the committed struct-closure binary and observable trace golden are byte-stable", () => {
  if (!existsSync(BIN_PATH)) {
    writeFileSync(BIN_PATH, serializeStructClosureBrainBytes());
  }
  const bin = new Uint8Array(readFileSync(BIN_PATH));
  assert.deepEqual(bin, serializeStructClosureBrainBytes(), "struct-closure.mcprogram.bin is not byte-stable");

  const first = runStructClosureTrace(bin);
  const second = runStructClosureTrace(bin);
  assert.equal(second.trace, first.trace, "two fresh runs must render byte-identical traces");

  const lines = first.trace.split("\n");
  assert.equal(lines.filter((line) => line.startsWith("tick ")).length, 3);
  // Nine set-pixel dispatches per tick, run thrice, with no faults.
  assert.equal(lines.filter((line) => line.startsWith("action 401 ")).length, 27);
  assert.equal(lines.filter((line) => line.startsWith("port display set-pixel ")).length, 27);
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);

  if (!existsSync(TRACE_PATH)) {
    writeFileSync(TRACE_PATH, first.trace);
  }
  assert.equal(readFileSync(TRACE_PATH, "utf8"), first.trace, "struct-closure.ticks.trace is not byte-stable");
});
