#pragma once

#include <cstdint>

#include "codal/device-port.h"

namespace mindcraft {

/**
 * Diagnostic-code family a device fault was raised from. The single-letter
 * prefix it maps to keeps the two numeric code spaces from colliding when they
 * are scrolled across the fault display.
 */
enum class FaultDomain : uint8_t {
  /** A `LoadError` raised while decoding the program image. Prefix `L`. */
  Load,
  /** An `ErrorCode` raised by the runtime while ticking. Prefix `E`. */
  Runtime,
};

/**
 * Size in bytes of the buffer {@link formatFaultCode} writes into, including
 * the terminator: a one-letter domain prefix, up to five decimal digits for a
 * 16-bit code, and a NUL.
 */
inline constexpr uint32_t kFaultCodeSize = 7;

/**
 * Format the stable fault code into `out` as a NUL-terminated ASCII string:
 * the domain letter (`L` for load, `E` for runtime) followed by the decimal
 * `code`, e.g. `"L3"` or `"E5"`. `out` must have room for {@link
 * kFaultCodeSize} bytes.
 */
void formatFaultCode(char* out, FaultDomain domain, uint16_t code);

/**
 * Render one show-the-error pass of the device fault mode: the fault face,
 * then `code` scrolled across the display once. The board-agnostic fault-mode
 * policy (stop ticking the brain, then loop this pass) sequences these two
 * port calls; the target's {@link FaultDisplayPort} owns how they look. The
 * caller's outer loop repeats the pass; each call may block for the duration
 * of the animation.
 */
void showFaultPass(FaultDisplayPort& display, const char* code);

} // namespace mindcraft
