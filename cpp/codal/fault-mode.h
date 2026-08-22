#pragma once

#include <cstdint>

#include "codal/device-port.h"

namespace wendoo {

/** Diagnostic-code family a device fault was raised from. */
enum class FaultDomain : uint8_t {
  /** A `LoadError` raised while decoding the program image. Prefix `L`. */
  Load,
  /** An `ErrorCode` raised by the runtime while ticking. Prefix `E`. */
  Runtime,
  /** A `RegionError` raised while validating the on-flash program region. Prefix `R`. */
  Region,
};

/**
 * Size in bytes of the buffer {@link formatFaultCode} writes into, including
 * the terminator: a one-letter domain prefix, up to five decimal digits for a
 * 16-bit code, and a NUL.
 */
inline constexpr uint32_t kFaultCodeSize = 7;

/**
 * Format the stable fault code into `out` as a NUL-terminated ASCII string:
 * the domain letter (`L` load, `E` runtime, `R` region) followed by the
 * decimal `code`, e.g. `"L3"`, `"E5"`, or `"R1"`. `out` must have room for
 * {@link kFaultCodeSize} bytes.
 */
void formatFaultCode(char* out, FaultDomain domain, uint16_t code);

/**
 * Render one show-the-error pass on `display`: the fault face, then `code`
 * scrolled across the display once. The call may block for the duration of the
 * animation; the caller repeats it to keep the fault mode on screen.
 */
void showFaultPass(FaultDisplayPort& display, const char* code);

} // namespace wendoo
