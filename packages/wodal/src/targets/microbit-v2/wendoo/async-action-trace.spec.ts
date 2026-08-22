/**
 * Hand-constructed synthetic conformance fixture, not recreatable from a real
 * compile: the single rule awaits a bytecode action and then reads the current
 * page (two actions in one rule, while the brain compiler emits one action per
 * rule).
 *
 * Golden observable trace for a device-free brain whose rule awaits an async,
 * non-host (bytecode) action. The rule dispatches the action through
 * ACTION_CALL_ASYNC + AWAIT: a child fiber runs the action body, returns a
 * value, and its completion resolves the handle the rule awaits; the rule then
 * reads the current page id as an observable marker. No microbit host actions
 * run, so the trace carries no device-port lines - the brain is device-free and
 * exercises the async bytecode-action opcode as a core capability.
 *
 * The serialized binary and rendered trace are pinned beside this spec as the
 * cross-VM conformance fixtures: the C++ VM parity test
 * (cpp/test/trace-parity.test.cpp) loads the same binary and byte-compares.
 */

import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { WendooEnvironment } from "@wendoo-lang/core/app";
import {
  BrainRuntime,
  CoreHostActions,
  type LinkedBrainProgramJson,
  linkedBrainProgramFromJson,
  Op,
  type PlatformServices,
} from "@wendoo-lang/core/runtime";
import { getWodalDeviceProfile, WodalDeviceProfileId } from "../../../wendoo/device-profile";
import { shouldWriteGolden } from "../../../wendoo/golden-regeneration";
import { parseWodalProgramImageBytes, serializeWodalProgramImageBytes } from "../../../wendoo/program-image-binary";
import { MicroBit } from "../microbit";
import { createMicroBitV2Environment } from "./environment";
import { ObservableTraceWriter, observableTraceVmEvents } from "./observable-trace";

const CURRENT_PAGE = CoreHostActions.CurrentPage.actionId;

const BIN_PATH = fileURLToPath(new URL("./__fixtures__/async-action.mcprogram.bin", import.meta.url));
const TRACE_PATH = fileURLToPath(new URL("./__fixtures__/async-action.ticks.trace", import.meta.url));

/**
 * A single-page brain. The rule awaits a bytecode action (slot 0) whose body
 * returns the number 7; on resume it stores the result into a brain variable and
 * reads the current page id (an observable, device-free core action).
 */
function buildAsyncActionBrainJson(): LinkedBrainProgramJson {
  const rule = [
    { op: Op.ACTION_CALL_ASYNC, a: 0, b: 0, c: 0 }, // await bytecode action slot 0
    { op: Op.AWAIT },
    { op: Op.STORE_VAR_SLOT, a: 0 }, // store the resolved result
    { op: Op.HOST_ACTION_CALL, a: CURRENT_PAGE, b: 0, c: 1 }, // observable marker
    { op: Op.POP },
    { op: Op.PUSH_CONST_VAL, a: 0 },
    { op: Op.RET },
  ];

  const actionBody = [
    { op: Op.PUSH_CONST_NUM, a: 0 }, // return value: 7
    { op: Op.RET },
  ];

  return {
    program: {
      version: 1,
      functions: [
        { code: rule, numParams: 0, numLocals: 0 },
        { code: actionBody, numParams: 0, numLocals: 0 },
      ],
      constantPools: { numbers: [7], strings: [], values: [{ t: 1 }] },
      types: [],
      variableNames: ["result"],
      entryPoint: 0,
      actions: [{ entryFuncId: 1 }],
      ruleFuncIds: [0],
      ruleAncestors: [],
    },
    pages: [
      {
        pageIndex: 0,
        pageId: "async-action-page",
        pageName: "Async Action Page",
        rootRuleFuncIds: [0],
        actionCallSites: [
          { binding: "bytecode", callSiteId: 0, actionSlot: 0 },
          { binding: "host", callSiteId: 1, actionId: CURRENT_PAGE },
        ],
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

function hostServicesOf(environment: WendooEnvironment): Omit<PlatformServices, "brain"> {
  const { runtime, shared, app } = environment.brainServices;
  return { runtime, shared, app };
}

/** Runs `bin` over `tickCount` 600ms thinks with the trace observers installed, returning the trace. */
function runTrace(bin: Uint8Array, tickCount: number): string {
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

  const microbit = new MicroBit();
  const vmEvents = observableTraceVmEvents(writer);

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

  let lastThinkTimeMs = 0;
  for (let i = 0; i < tickCount; i++) {
    const timeMs = lastThinkTimeMs + 600;
    writer.tick(i + 1, timeMs, lastThinkTimeMs === 0 ? 0 : timeMs - lastThinkTimeMs);
    brain.think(timeMs);
    lastThinkTimeMs = timeMs;
  }
  return writer.render();
}

test("the committed async-action binary and observable trace golden are byte-stable", () => {
  if (shouldWriteGolden(BIN_PATH)) {
    writeFileSync(BIN_PATH, serializeBrainBytes(buildAsyncActionBrainJson()));
  }
  const bin = new Uint8Array(readFileSync(BIN_PATH));
  assert.deepEqual(
    bin,
    serializeBrainBytes(buildAsyncActionBrainJson()),
    "async-action.mcprogram.bin is not byte-stable"
  );

  const first = runTrace(bin, 4);
  const second = runTrace(bin, 4);
  assert.equal(second, first, "two fresh runs must render byte-identical traces");

  const lines = first.split("\n");
  assert.equal(lines.filter((line) => line.startsWith("tick ")).length, 4);
  // The async action completes one round after it is dispatched and the rule
  // resumes the round after that, reading the page id on tick 3 - proof the
  // awaited bytecode action resolved and the rule ran past the await.
  assert.equal(
    lines.filter((line) => new RegExp(`^action ${CURRENT_PAGE} .+ result string "async-action-page"$`).test(line))
      .length,
    1
  );
  // Device-free: no host-action ports are ever written.
  assert.equal(lines.filter((line) => line.startsWith("port ")).length, 0);
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);

  if (shouldWriteGolden(TRACE_PATH)) {
    writeFileSync(TRACE_PATH, first);
  }
  assert.equal(readFileSync(TRACE_PATH, "utf8"), first, "async-action.ticks.trace is not byte-stable");
});
