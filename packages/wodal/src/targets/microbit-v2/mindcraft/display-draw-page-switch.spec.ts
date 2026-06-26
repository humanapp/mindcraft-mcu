/**
 * Lifecycle regression: a timed draw holds the display lease and parks its rule
 * on the awaited handle; a sibling rule then switches pages, which cancels the
 * parked fiber. The display lease persists across the page change (the display
 * is not reset on a page switch), so when the hold elapses the lease still fires
 * `handle.resolve` on the cancelled fiber's handle. This asserts that resolve is
 * a safe no-op once the fiber is gone: no fault is raised, the handle resumes
 * nobody, and the new page keeps running.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
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
import { WODAL_SHARED_TYPE_IDS, WodalSharedTypeAtomId } from "../../../mindcraft/shared-type-ids";
import { MicroBit } from "../microbit";
import { createMicroBitV2Environment } from "./environment";
import { MicroBitV2HostActions } from "./tile-ids";

const SWITCH_PAGE = CoreHostActions.SwitchPage.actionId;
const DRAW_IMAGE = MicroBitV2HostActions.DrawImage.actionId;
const DISPLAY_SET_PIXEL = MicroBitV2HostActions.DisplaySetPixel.actionId;

/** Milliseconds advanced per think. */
const TICK_ADVANCE_MS = 100;

/** Hold of the timed draw in seconds (150ms), completing two thinks after dispatch (after the page switch). */
const HOLD_SECONDS = 0.15;

/** A 5x5 image whose top row is full brightness, baked as the drawn `Image`. */
const TOP_ROW_PIXELS_HEX = `ffffffffff${"00".repeat(20)}`;

/**
 * A two-page brain. Page 0 rule 0 draws a timed image (taking the lease) and
 * awaits it; page 0 rule 1 switches to page 2, cancelling rule 0's parked fiber.
 * Page 1 rule 2 lights pixel (4,4) each think, proving the brain runs after the
 * switch.
 */
function buildPageSwitchBrainJson(): LinkedBrainProgramJson {
  const drawer = [
    { op: Op.PUSH_CONST_VAL, a: 1 }, // the Image
    { op: Op.PUSH_CONST_NUM, a: 0 }, // duration = HOLD_SECONDS
    { op: Op.HOST_ACTION_CALL_ASYNC, a: DRAW_IMAGE, b: 2, c: 0 },
    { op: Op.AWAIT },
    { op: Op.POP },
    { op: Op.PUSH_CONST_VAL, a: 0 },
    { op: Op.RET },
  ];
  const switcher = [
    { op: Op.PUSH_CONST_NUM, a: 1 }, // switch-page number slot: page 2 (1-based)
    { op: Op.PUSH_CONST_VAL, a: 0 }, // switch-page string slot: nil
    { op: Op.HOST_ACTION_CALL, a: SWITCH_PAGE, b: 2, c: 1 },
    { op: Op.POP },
    { op: Op.PUSH_CONST_VAL, a: 0 },
    { op: Op.RET },
  ];
  const pageOneRule = [
    { op: Op.PUSH_CONST_NUM, a: 2 }, // x = 4
    { op: Op.PUSH_CONST_NUM, a: 2 }, // y = 4
    { op: Op.PUSH_CONST_NUM, a: 3 }, // brightness = 255
    { op: Op.HOST_ACTION_CALL, a: DISPLAY_SET_PIXEL, b: 3, c: 2 },
    { op: Op.POP },
    { op: Op.PUSH_CONST_VAL, a: 0 },
    { op: Op.RET },
  ];

  return {
    program: {
      version: 1,
      functions: [
        { code: drawer, numParams: 0, numLocals: 0 },
        { code: switcher, numParams: 0, numLocals: 0 },
        { code: pageOneRule, numParams: 0, numLocals: 0 },
      ],
      constantPools: {
        numbers: [HOLD_SECONDS, 2, 4, 255],
        strings: [],
        values: [
          { t: NativeType.Nil },
          {
            t: NativeType.Struct,
            typeId: WODAL_SHARED_TYPE_IDS.Image,
            v: [
              { t: NativeType.Number, v: 5 },
              { t: NativeType.Number, v: 5 },
              { t: NativeType.Buffer, v: TOP_ROW_PIXELS_HEX },
            ],
          },
        ],
      },
      types: [{ tag: "atom", typeId: WODAL_SHARED_TYPE_IDS.Image, atomId: WodalSharedTypeAtomId.Image }],
      variableNames: [],
      entryPoint: 0,
      actions: [],
      ruleFuncIds: [0, 1, 2],
      ruleAncestors: [],
    },
    pages: [
      {
        pageIndex: 0,
        pageId: "draw-page-0",
        pageName: "Draw Page 0",
        rootRuleFuncIds: [0, 1],
        actionCallSites: [
          { binding: "host", callSiteId: 0, actionId: DRAW_IMAGE },
          { binding: "host", callSiteId: 1, actionId: SWITCH_PAGE },
        ],
      },
      {
        pageIndex: 1,
        pageId: "draw-page-1",
        pageName: "Draw Page 1",
        rootRuleFuncIds: [2],
        actionCallSites: [{ binding: "host", callSiteId: 2, actionId: DISPLAY_SET_PIXEL }],
      },
    ],
  } as LinkedBrainProgramJson;
}

function hostServicesOf(environment: MindcraftEnvironment): Omit<PlatformServices, "brain"> {
  const { runtime, shared, app } = environment.brainServices;
  return { runtime, shared, app };
}

test("a draw lease fires resolve safely after a page switch cancels the awaiting fiber", () => {
  const environment = createMicroBitV2Environment();
  const profile = getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2);
  const program = linkedBrainProgramFromJson(buildPageSwitchBrainJson());

  const faults: number[] = [];
  const vmEvents: VmEvents = {
    onFiberFault: (payload) => faults.push(payload.err.code),
  };

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

  const step = (timeMs: number): void => {
    brain.think(timeMs);
    microbit.display.advanceScroll(timeMs);
  };

  // Think 1: the drawer paints the image (taking the lease) and parks; the
  // switcher requests page 2. The draw's hold (until 250) has not elapsed.
  step(TICK_ADVANCE_MS);
  assert.equal(microbit.display.getPixelValue(0, 0), 255, "the timed draw paints before the switch");

  // Think 2: page 1 is active and the parked drawer fiber has been cancelled by
  // the page change, but the lease still holds until its hold elapses.
  step(2 * TICK_ADVANCE_MS);
  assert.equal(microbit.display.isBusy(), true, "the lease persists across the page switch");
  assert.equal(microbit.display.getPixelValue(4, 4), 255, "the new page runs after the switch");

  // Think 3: the hold elapses (300 >= 250), so the lease fires resolve on the
  // cancelled fiber's handle. This must be a safe no-op.
  step(3 * TICK_ADVANCE_MS);
  assert.equal(microbit.display.isBusy(), false, "the lease releases when its hold elapses");

  // A further think confirms the runtime stayed healthy through the stale resolve.
  step(4 * TICK_ADVANCE_MS);
  assert.equal(microbit.display.getPixelValue(4, 4), 255, "the new page keeps running");
  assert.deepEqual(faults, [], "resolve on a cancelled fiber's handle raises no fault");
});
