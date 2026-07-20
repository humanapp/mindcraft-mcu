import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { BUILT_IN_SOUNDS } from "./mindcraft/built-in-sounds";
import { decodeAllBuiltInSounds, decodeBuiltInSound, decodeSoundExpression } from "./sound-expression";

describe("sound-expression decoder", () => {
  test("each built-in's decoded segment durations sum to its pinned nominal duration", () => {
    for (const def of BUILT_IN_SOUNDS) {
      const segments = decodeSoundExpression(def.encoded);
      const total = segments.reduce((sum, segment) => sum + segment.durationMs, 0);
      assert.equal(
        total,
        def.durationMs,
        `${def.name}: decoded duration sum ${total} != pinned nominal ${def.durationMs}`
      );
    }
  });

  test("decodeBuiltInSound resolves the built-in set and rejects unknown names", () => {
    assert.equal(decodeBuiltInSound("hello")?.length, 3);
    assert.equal(decodeBuiltInSound("giggle")?.length, 5);
    assert.equal(decodeBuiltInSound("bogus"), undefined);
  });

  test("decodeAllBuiltInSounds returns every built-in keyed by name", () => {
    const map = decodeAllBuiltInSounds();
    assert.equal(map.size, BUILT_IN_SOUNDS.length);
    for (const def of BUILT_IN_SOUNDS) {
      assert.equal(map.get(def.name)?.length, decodeSoundExpression(def.encoded).length);
    }
  });

  test("decodes the CODAL field layout of a known segment", () => {
    // giggle segment 1: sine wave, volume 1023, start 988 Hz, 190 ms, arpeggio (no swept end).
    const [segment] = decodeSoundExpression("010230988019008440044008881023001601003300240000000000000000000000000000");
    assert.equal(segment?.waveform, "sine");
    assert.equal(segment?.startFrequency, 988);
    assert.equal(segment?.durationMs, 190);
    assert.equal(segment?.startVolume, 1023);
    assert.equal(segment?.interpolation, "arpeggio-ascending");
    assert.equal(segment?.endFrequency, 988);
  });

  test("a swept segment carries its end frequency and interpolation shape", () => {
    // hello segment 1: square wave, start 673 Hz, curve sweep to 1187 Hz, 197 ms.
    const [segment] = decodeSoundExpression("310230673019702440118708881023012800000000240000000000000000000000000000");
    assert.equal(segment?.waveform, "square");
    assert.equal(segment?.startFrequency, 673);
    assert.equal(segment?.durationMs, 197);
    assert.equal(segment?.interpolation, "curve");
    assert.equal(segment?.endFrequency, 1187);
  });

  test("rejects a malformed segment", () => {
    assert.throws(() => decodeSoundExpression("not-72-chars"));
  });
});
