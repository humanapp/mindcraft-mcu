#pragma once

#include <cstdint>

namespace mindcraft
{

/**
 * Pinned built-in sound-emoji table for the microbit-v2 speaker. Mirrors
 * packages/wodal/src/targets/microbit-v2/mindcraft/built-in-sounds.ts; the
 * observable-trace goldens hold the two sides equal. Each nominal duration is
 * the sum of the sound's encoded CODAL segment durations (codal-microbit-v2
 * `SoundExpressions.cpp`) with every randomized contribution read as zero;
 * the speaker lease runs for exactly this long. Append-only: never rename or
 * repurpose an entry.
 */

/** Field id and storage slot of the `SoundEmoji` struct's `name` field. */
inline constexpr uint32_t kSoundEmojiNameFieldId = 0;

/** Sound played when the play-sound call omits the optional sound argument. */
inline constexpr char kSoundEmojiDefaultName[] = "hello";

/** One built-in sound emoji: its name and nominal total duration. */
struct SoundEmojiDef
{
    const char *name;
    uint32_t durationMs;
};

/** The 10 built-in sound emoji with their nominal total durations in milliseconds. */
inline constexpr SoundEmojiDef kSoundEmojiTable[] = {
    {"giggle", 1491}, {"happy", 1259},   {"hello", 506},   {"mysterious", 4181}, {"sad", 1644},
    {"slide", 1133},  {"soaring", 8039}, {"spring", 2326}, {"twinkle", 6722},    {"yawn", 2812},
};

/**
 * Resolves the nominal total duration of the built-in sound named by `length`
 * ASCII bytes, writing it to `durationMs` and returning true. Returns false
 * (leaving `durationMs` untouched) for a name outside the built-in set.
 */
inline bool soundEmojiDurationMs(const uint8_t *name, uint32_t length, uint32_t &durationMs)
{
    for (const SoundEmojiDef &def : kSoundEmojiTable)
    {
        uint32_t i = 0;
        while (i < length && def.name[i] != '\0' && static_cast<uint8_t>(def.name[i]) == name[i])
        {
            i++;
        }
        if (i == length && def.name[i] == '\0')
        {
            durationMs = def.durationMs;
            return true;
        }
    }
    return false;
}

} // namespace mindcraft
