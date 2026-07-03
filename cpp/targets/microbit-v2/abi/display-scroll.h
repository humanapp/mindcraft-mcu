#pragma once

#include <cstdint>

namespace mindcraft
{

/**
 * Pinned scroll completion-time spec for the microbit-v2 display. Mirrors
 * packages/wodal/src/targets/microbit-v2/mindcraft/display-scroll.ts; the
 * observable-trace goldens hold the two sides equal. The animation advances one
 * step every per-step delay (CODAL `AnimatedDisplay::updateScrollText`); a
 * character occupies {@link kScrollDisplayWidth} columns plus
 * {@link kScrollDisplaySpacing} blank column, then one further blank cycle of
 * the same width clears the last character off the display before completion.
 * The character count is the text's byte length (CODAL `ManagedString::length`)
 * for the ASCII text the scroll action accepts.
 *
 * A one-character text renders as a static show instead of scrolling; it holds
 * the display for the same completion time this formula gives one character.
 */

/** Display matrix width in columns, CODAL `Display::getWidth()` for the 5x5 matrix. */
inline constexpr uint32_t kScrollDisplayWidth = 5;

/** Blank columns inserted between consecutive characters, CODAL `DISPLAY_SPACING`. */
inline constexpr uint32_t kScrollDisplaySpacing = 1;

/** Default per-step delay in milliseconds, CODAL `DISPLAY_DEFAULT_SCROLL_SPEED`. */
inline constexpr uint32_t kScrollDefaultDelayMs = 120;

/**
 * Animation steps to scroll one character fully off the display:
 * {@link kScrollDisplayWidth} visible columns plus {@link kScrollDisplaySpacing}
 * trailing blank column, CODAL's `display.getWidth() + DISPLAY_SPACING` reset
 * period in `updateScrollText`.
 */
inline constexpr uint32_t kScrollStepsPerCharacter = kScrollDisplayWidth + kScrollDisplaySpacing;

/**
 * Number of animation steps a scroll of `characterCount` characters runs before
 * completion, including the trailing blank cycle that clears the final character.
 */
inline constexpr uint32_t scrollStepCount(uint32_t characterCount)
{
    return kScrollStepsPerCharacter * (characterCount + 1);
}

/**
 * Elapsed milliseconds from a scroll's start to its completion, for a text of
 * `characterCount` characters animated at `delayMs` per step.
 */
inline constexpr uint32_t scrollDurationMs(uint32_t characterCount, uint32_t delayMs)
{
    return scrollStepCount(characterCount) * delayMs;
}

} // namespace mindcraft
