#pragma once

#include <cstddef>
#include <cstdint>

#include "core/runtime/fiber-scheduler.h"

namespace mindcraft {

/**
 * Memory-provisioning figures for a device target's VM working set, which is
 * drawn entirely from one {@link RegionArena}: the per-fiber cost, a
 * region-size helper, and a recommended region size.
 */

/**
 * Region bytes one live fiber occupies: its {@link FiberWorkspace} (operand
 * stack, locals, and frame regions at the per-fiber caps) plus its
 * {@link FiberRecord}.
 */
inline constexpr uint32_t kPerFiberBytes = sizeof(FiberWorkspace) + sizeof(FiberRecord);

/**
 * Region bytes needed for a `programBytes` program image plus `peakLiveFibers`
 * fibers live at once. A brain exceeding the provisioned region faults
 * `ErrorCode::StackOverflow` at spawn.
 */
inline constexpr uint32_t vmRegionBytesFor(uint32_t programBytes, uint32_t peakLiveFibers) {
  return programBytes + peakLiveFibers * kPerFiberBytes;
}

/**
 * Recommended region size for the button-display slice and small brains on a
 * 128 KiB-SRAM class device.
 */
inline constexpr uint32_t kRecommendedVmArenaBytes = 48u * 1024u;

} // namespace mindcraft
