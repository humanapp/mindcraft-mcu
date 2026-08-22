/**
 * Compile-and-run coverage for the micro:bit standard library's `sounds` const
 * object: a user tile `@lib`-imports `sounds` from the stdlib layer and awaits
 * `ctx.microbit.audio.playSound(sounds.twinkle)`; the brain compiles cleanly
 * and exactly one play of the named built-in crosses the simulated speaker.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { BrainDef } from "@wendoo/core/app";
import { buildWodalProgramImage, getWodalDeviceProfile, WodalDeviceProfileId } from "@wendoo/wodal";
import { MicroBit, WodalMicroBitRuntime } from "@wendoo/wodal/targets/microbit-v2";
import { MICROBIT_V2_LIB_COORDINATE } from "../services/microbit-extension-coordinates";
import { buildExtensionTestHarness } from "./extension-test-harness";

/** An always-true trigger, so the rule driving it fires every think. */
const ALWAYS_SOURCE = `import { type Context, Sensor } from "wendoo";

export default Sensor({
  name: "always",
  onExecute(ctx: Context): boolean {
    return ctx.microbit.buttonA.isPressed() >= 0;
  },
});
`;

/** An async actuator that names a built-in sound through the stdlib's `sounds` const object. */
const PLAY_TWINKLE_SOURCE = `import { Actuator, type Context } from "wendoo";
import { sounds } from "@lib/${MICROBIT_V2_LIB_COORDINATE}";

export default Actuator({
  name: "play twinkle",
  async onExecute(ctx: Context): Promise<void> {
    await ctx.microbit.audio.playSound(sounds.twinkle);
  },
});
`;

describe("micro:bit standard library -- the sounds const object", () => {
  test("a user tile naming a built-in through sounds compiles and its play reaches the speaker", () => {
    // The harness asserts the compile is diagnostic-free, so a broken stdlib
    // export or a mistyped member would fail here before the run.
    const harness = buildExtensionTestHarness({
      install: [],
      workspaceTiles: { "always.ts": ALWAYS_SOURCE, "play-twinkle.ts": PLAY_TWINKLE_SOURCE },
    });
    const env = harness.env;

    const brainDef = BrainDef.emptyBrainDef(env.brainServices, "sounds const object brain");
    const rule = brainDef.pages().get(0)!.children().get(0);
    assert.ok(rule, "the empty brain seeds one rule");
    rule.when().appendTile(harness.userTile("always"));
    rule.do().appendTile(harness.userTile("play twinkle"));

    const built = buildWodalProgramImage({
      brainDef,
      environment: env,
      deviceProfile: getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2),
    });
    assert.ok(built.ok, `expected a successful build: ${built.ok ? "" : JSON.stringify(built.errors)}`);

    const microbit = new MicroBit();
    const plays: string[] = [];
    const devicePlaySoundEmoji = microbit.speaker.playSoundEmoji.bind(microbit.speaker);
    microbit.speaker.playSoundEmoji = (name, requestTime, onComplete) => {
      plays.push(name);
      devicePlaySoundEmoji(name, requestTime, onComplete);
    };

    const runtime = new WodalMicroBitRuntime({ environment: env, microbit });
    assert.deepEqual(runtime.loadWodalProgramImage(built.image), { ok: true }, "program should load");
    for (let i = 0; i < 3; i++) {
      runtime.tick(16);
    }

    // The rule fires on the first think and its async actuator dispatches the
    // play on the next; the sound's nominal duration outlasts the short run,
    // so the awaited actuator parks and exactly one play crosses the port.
    assert.deepEqual(plays, ["twinkle"], "the stdlib-named built-in reaches the speaker exactly once");
  });
});
