/**
 * Page-switch resource + scheduler regression. A real-compiled two-page brain
 * where each page has two rules that both fire on page entry: rule 0
 * unconditionally switches to the other page, and rule 1 (still queued for the
 * round when rule 0 fires) writes a pixel. Because the brain ping-pongs between
 * its two pages, every think re-enters a page and re-arms the switch, so the
 * mid-round switch repeats indefinitely. This pins two C++-port regressions:
 *
 * - Region leak: the active page's root-rule tracking is allocated once for the
 *   brain's lifetime; a per-activation allocation would leak the bump region and
 *   fault once it exhausted after enough switches.
 * - Mid-round cancel: rule 0's page switch cancels rule 1 while it is still
 *   queued for the round, draining the run queue below the round's snapshot size;
 *   the scheduler must stop the round when the queue empties.
 *
 * The fixture is built through the real brain compiler, so the bytecode carries
 * the WHEN/DO boundary opcodes and the multi-rule page structure the hand-rolled
 * shape-alike never had. It is pinned for the C++ parity test, which replays many
 * thousands of switches and asserts the runtime never faults.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { mkActuatorTileId, mkSensorTileId, type WendooEnvironment } from "@wendoo-lang/core/app";
import { type IBrainPageDef, type IBrainTileDef, mkPageTileId } from "@wendoo-lang/core/brain";
import { BrainDef } from "@wendoo-lang/core/brain/model";
import {
  BrainRuntime,
  CoreHostActions,
  type LinkedBrainProgram,
  linkedBrainProgramToJson,
  Op,
  type PlatformServices,
  type VmEvents,
} from "@wendoo-lang/core/runtime";
import { buildWodalProgramImage } from "../../../wendoo/build-kernel";
import { getWodalDeviceProfile, WodalDeviceProfileId } from "../../../wendoo/device-profile";
import { shouldWriteGolden } from "../../../wendoo/golden-regeneration";
import { serializeWodalProgramImageJson, type WodalProgramImage } from "../../../wendoo/program-image";
import { parseWodalProgramImageBytes, wodalProgramBytes } from "../../../wendoo/program-image-binary";
import { MicroBit } from "../microbit";
import { createMicroBitV2Environment } from "./environment";
import { MicroBitV2HostActions } from "./tile-ids";

const JSON_PATH = fileURLToPath(new URL("./__fixtures__/multi-rule-page-switch.mcprogram", import.meta.url));
const BIN_PATH = fileURLToPath(new URL("./__fixtures__/multi-rule-page-switch.mcprogram.bin", import.meta.url));

/**
 * Fills one page with a switch rule ahead of a set-pixel sibling rule, both
 * triggered by page entry. The switch rule (rule 0) targets `targetPageTile`
 * through the switch-page actuator's page-reference slot; the set-pixel rule
 * (rule 1) runs with the actuator's defaults (x=0, y=0, brightness=255).
 */
function fillSwitchPage(env: WendooEnvironment, page: IBrainPageDef, targetPageTile: IBrainTileDef): void {
  const tiles = env.brainServices.edit.tiles;
  const onPageEntered = tiles.get(mkSensorTileId(CoreHostActions.OnPageEntered.key));
  const switchPage = tiles.get(mkActuatorTileId(CoreHostActions.SwitchPage.key));
  const setPixel = tiles.get(mkActuatorTileId(MicroBitV2HostActions.DisplaySetPixel.key));
  assert.ok(onPageEntered && switchPage && setPixel);

  const switchRule = page.children().get(0)!;
  switchRule.when().appendTile(onPageEntered);
  switchRule.do().appendTile(switchPage);
  switchRule.do().appendTile(targetPageTile);

  const pixelRule = page.appendNewRule()!;
  pixelRule.when().appendTile(onPageEntered);
  pixelRule.do().appendTile(setPixel);
}

/**
 * Builds a two-page brain. Page 0's switch rule targets page 1 and page 1's
 * switch rule targets page 0, so the brain ping-pongs every think; each page's
 * switch rule sits ahead of its set-pixel sibling.
 */
function buildMultiRuleSwitchBrainDef(env: WendooEnvironment): BrainDef {
  const brainDef = BrainDef.emptyBrainDef(env.brainServices, "multi-rule page switch brain");
  const page0 = brainDef.pages().get(0)!;
  const appended = brainDef.appendNewPage();
  assert.ok(appended.success);
  const page1 = appended.value.page;

  const page0Tile = brainDef.catalog().get(mkPageTileId(page0.pageId()));
  const page1Tile = brainDef.catalog().get(mkPageTileId(page1.pageId()));
  assert.ok(page0Tile && page1Tile);

  fillSwitchPage(env, page0, page1Tile);
  fillSwitchPage(env, page1, page0Tile);
  return brainDef;
}

/** Builds the multi-rule-page-switch image through the standard build path. */
function buildImage(env: WendooEnvironment): WodalProgramImage<LinkedBrainProgram> {
  const built = buildWodalProgramImage({
    brainDef: buildMultiRuleSwitchBrainDef(env),
    environment: env,
    deviceProfile: getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2),
  });
  if (!built.ok) {
    assert.fail(`expected a successful build: ${JSON.stringify(built.errors)}`);
  }
  return built.image;
}

/** Writes the JSON `.mcprogram` golden if missing, freezing the brain's generated page ids. */
function ensureJsonGolden(): void {
  if (existsSync(JSON_PATH)) {
    return;
  }
  const image = buildImage(createMicroBitV2Environment());
  writeFileSync(
    JSON_PATH,
    serializeWodalProgramImageJson({ ...image, program: linkedBrainProgramToJson(image.program) })
  );
}

function hostServicesOf(environment: WendooEnvironment): Omit<PlatformServices, "brain"> {
  const { runtime, shared, app } = environment.brainServices;
  return { runtime, shared, app };
}

test("a multi-rule page that switches mid-round runs fault-free, and the fixture is byte-stable", () => {
  ensureJsonGolden();
  const generated = wodalProgramBytes(new Uint8Array(readFileSync(JSON_PATH)));
  if (shouldWriteGolden(BIN_PATH)) {
    writeFileSync(BIN_PATH, generated);
  }
  const bin = new Uint8Array(readFileSync(BIN_PATH));
  assert.deepEqual(bin, generated, "multi-rule-page-switch.mcprogram.bin is not byte-stable");

  // The real compiler frames each rule's when()/do() with the boundary opcodes
  // the hand-rolled shape-alike never carried.
  const golden = JSON.parse(readFileSync(JSON_PATH, "utf8")) as {
    program: { program: { functions: { code: { op: number }[] }[] } };
  };
  const opcodes = new Set<number>();
  for (const fn of golden.program.program.functions) {
    for (const ins of fn.code) {
      opcodes.add(ins.op);
    }
  }
  for (const boundary of [Op.WHEN_START, Op.WHEN_END, Op.DO_START, Op.DO_END]) {
    assert.ok(opcodes.has(boundary), `compiled bytecode should carry boundary opcode ${boundary}`);
  }

  const environment = createMicroBitV2Environment();
  const profile = getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2);
  const decoded = parseWodalProgramImageBytes(
    bin,
    WodalDeviceProfileId.MICROBIT_V2,
    environment.brainServices.runtime.types
  );
  const program = decoded.program;

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
