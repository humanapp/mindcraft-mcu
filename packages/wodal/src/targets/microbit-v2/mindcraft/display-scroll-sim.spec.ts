/**
 * End-to-end check of the simulated scroll through the WodalMicroBitRuntime tick
 * path that apps/microbit-sim drives from its render loop: loading the committed
 * scroll brain and advancing time must animate glyph pixels on the display while
 * the rule awaits, then resume the rule and light its pixel once the scroll
 * completes.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { getWodalDeviceProfile, WodalDeviceProfileId } from "../../../mindcraft/device-profile";
import { parseWodalProgramImageBytes } from "../../../mindcraft/program-image-binary";
import { MicroBit } from "../microbit";
import { createMicroBitV2Environment } from "./environment";
import { WodalMicroBitRuntime } from "./runtime";

const BIN_PATH = fileURLToPath(new URL("./__fixtures__/display-scroll.mcprogram.bin", import.meta.url));

test("the simulated runtime animates the scroll and resumes the awaiting rule", () => {
  const environment = createMicroBitV2Environment();
  const profile = getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2);
  const decoded = parseWodalProgramImageBytes(
    new Uint8Array(readFileSync(BIN_PATH)),
    WodalDeviceProfileId.MICROBIT_V2,
    environment.brainServices.runtime.types
  );

  const microbit = new MicroBit();
  const runtime = new WodalMicroBitRuntime({ environment, microbit });
  assert.deepEqual(runtime.loadWodalProgramImage(profile.createProgramImage(decoded.program)), { ok: true });

  // Advance time the way the render loop does: many small ticks. While the rule
  // is parked on the scroll handle the display is mid-animation, so any lit
  // pixel comes from the scrolling glyphs, not the rule's later pixel write.
  let litWhileScrolling = false;
  for (let i = 0; i < 40; i++) {
    runtime.tick(100);
    if (microbit.display.isScrolling() && microbit.snapshot().display.pixels.some((value) => value > 0)) {
      litWhileScrolling = true;
    }
  }

  assert.ok(litWhileScrolling, "the scroll should light glyph pixels while animating");
  // After the scroll completes the rule resumes and lights pixel (0,0).
  assert.equal(microbit.display.getPixelValue(0, 0), 255);
});
