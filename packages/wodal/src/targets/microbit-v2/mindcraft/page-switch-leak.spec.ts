/**
 * Page-switch resource + scheduler regression. A two-page brain where each page
 * has two rules: rule 0 unconditionally switches to the other page, and rule 1
 * (still queued for the round when rule 0 fires) writes a pixel. This pins two
 * C++-port regressions the TS oracle never had:
 *
 * - Region leak: the active page's root-rule tracking is allocated once for the
 *   brain's lifetime; a per-activation allocation would leak the bump region and
 *   fault once it exhausted after enough switches.
 * - Mid-round cancel: rule 0's page switch cancels rule 1 while it is still
 *   queued for the round, draining the run queue below the round's snapshot size;
 *   the scheduler must stop the round when the queue empties.
 *
 * The fixture is pinned for the C++ parity test, which replays many thousands of
 * switches and asserts the runtime never faults. The TS oracle here confirms the
 * same brain runs fault-free as the byte-identical reference.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { MindcraftEnvironment } from "@mindcraft-lang/core/app";
import {
  BrainRuntime,
  CoreHostActions,
  type LinkedBrainProgramJson,
  linkedBrainProgramFromJson,
  NativeType,
  Op,
  type PlatformServices,
  type VmEvents,
} from "@mindcraft-lang/core/runtime";
import { getWodalDeviceProfile, WodalDeviceProfileId } from "../../../mindcraft/device-profile";
import { serializeWodalProgramImageBytes } from "../../../mindcraft/program-image-binary";
import { MicroBit } from "../microbit";
import { createMicroBitV2Environment } from "./environment";
import { MicroBitV2HostActions } from "./tile-ids";

const SWITCH_PAGE = CoreHostActions.SwitchPage.actionId;
const DISPLAY_SET_PIXEL = MicroBitV2HostActions.DisplaySetPixel.actionId;

const BIN_PATH = fileURLToPath(new URL("./__fixtures__/multi-rule-page-switch.mcprogram.bin", import.meta.url));

/**
 * A two-page brain where each page has a switch rule (rule 0) followed by a
 * sibling set-pixel rule (rule 1). Rule 0 switches every think while rule 1 is
 * still queued, so the switch's fiber cancellation drains the round's queue.
 */
function buildMultiRuleSwitchBrainJson(): LinkedBrainProgramJson {
  const switchTo = (numberIndex: number, callSiteId: number) => [
    { op: Op.PUSH_CONST_NUM, a: numberIndex }, // switch-page number (1-based)
    { op: Op.PUSH_CONST_VAL, a: 0 }, // switch-page string slot: nil
    { op: Op.HOST_ACTION_CALL, a: SWITCH_PAGE, b: 2, c: callSiteId },
    { op: Op.POP },
    { op: Op.PUSH_CONST_VAL, a: 0 },
    { op: Op.RET },
  ];
  const setPixel = (callSiteId: number) => [
    { op: Op.PUSH_CONST_NUM, a: 2 }, // x = 0
    { op: Op.PUSH_CONST_NUM, a: 2 }, // y = 0
    { op: Op.PUSH_CONST_NUM, a: 3 }, // brightness = 255
    { op: Op.HOST_ACTION_CALL, a: DISPLAY_SET_PIXEL, b: 3, c: callSiteId },
    { op: Op.POP },
    { op: Op.PUSH_CONST_VAL, a: 0 },
    { op: Op.RET },
  ];

  return {
    program: {
      version: 1,
      functions: [
        { code: switchTo(0, 0), numParams: 0, numLocals: 0 }, // page 0 -> page 2
        { code: setPixel(1), numParams: 0, numLocals: 0 },
        { code: switchTo(1, 2), numParams: 0, numLocals: 0 }, // page 1 -> page 1
        { code: setPixel(3), numParams: 0, numLocals: 0 },
      ],
      constantPools: { numbers: [2, 1, 0, 255], strings: [], values: [{ t: NativeType.Nil }] },
      types: [],
      variableNames: [],
      entryPoint: 0,
      actions: [],
      ruleFuncIds: [0, 1, 2, 3],
      ruleAncestors: [],
    },
    pages: [
      {
        pageIndex: 0,
        pageId: "mrps-page-0",
        pageName: "MRPS Page 0",
        rootRuleFuncIds: [0, 1],
        actionCallSites: [
          { binding: "host", callSiteId: 0, actionId: SWITCH_PAGE },
          { binding: "host", callSiteId: 1, actionId: DISPLAY_SET_PIXEL },
        ],
      },
      {
        pageIndex: 1,
        pageId: "mrps-page-1",
        pageName: "MRPS Page 1",
        rootRuleFuncIds: [2, 3],
        actionCallSites: [
          { binding: "host", callSiteId: 2, actionId: SWITCH_PAGE },
          { binding: "host", callSiteId: 3, actionId: DISPLAY_SET_PIXEL },
        ],
      },
    ],
  } as LinkedBrainProgramJson;
}

function serializeBrainBytes(json: LinkedBrainProgramJson): Uint8Array {
  const environment = createMicroBitV2Environment();
  const profile = getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2);
  return serializeWodalProgramImageBytes(
    profile.createProgramImage(linkedBrainProgramFromJson(json)),
    environment.brainServices.runtime.types
  );
}

function hostServicesOf(environment: MindcraftEnvironment): Omit<PlatformServices, "brain"> {
  const { runtime, shared, app } = environment.brainServices;
  return { runtime, shared, app };
}

test("a multi-rule page that switches mid-round runs fault-free, and the fixture is byte-stable", () => {
  if (!existsSync(BIN_PATH)) {
    writeFileSync(BIN_PATH, serializeBrainBytes(buildMultiRuleSwitchBrainJson()));
  }
  const bin = new Uint8Array(readFileSync(BIN_PATH));
  assert.deepEqual(
    bin,
    serializeBrainBytes(buildMultiRuleSwitchBrainJson()),
    "multi-rule-page-switch.mcprogram.bin is not byte-stable"
  );

  const environment = createMicroBitV2Environment();
  const profile = getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2);
  const program = linkedBrainProgramFromJson(buildMultiRuleSwitchBrainJson());

  const faults: number[] = [];
  const vmEvents: VmEvents = { onFiberFault: (payload) => faults.push(payload.err.code) };

  const microbit = new MicroBit();
  const brain = new BrainRuntime(
    program.program,
    program.pages,
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

  for (let i = 0; i < 20000; i++) {
    brain.think(i + 1);
  }
  assert.deepEqual(faults, [], "page switching must not fault");
});
