#pragma once

#include <cstdint>

#include "core/runtime/execution-state.h"
#include "core/runtime/fiber-scheduler.h"
#include "core/runtime/value.h"

namespace mindcraft {

/**
 * Device memory analysis for the VM working set, expressed as a single
 * carve-on-demand {@link RegionArena} the firmware hands the runtime. There is
 * no pre-partitioned per-fiber pool: the program image is allocated once at the
 * base of the arena, and each live fiber's stack/locals/frame segments are
 * carved above it at spawn and released at reclaim - so dormant fiber capacity
 * costs zero arena bytes, and the arena's size is the one number a target
 * picks, against the free SRAM left after CODAL rather than a worst-case
 * `fibers x caps` product.
 *
 * The figures below are the cost components used to provision that single
 * arena; the byte sizes use only pointer-free element types (`Value`, `Frame`),
 * so they are identical on the 32-bit device and the 64-bit host - the host
 * parity build allocates the same arena, exercising the device analysis on CI.
 */

/**
 * Bytes one live fiber's segments occupy at the per-fiber ceilings: a full
 * operand stack, locals region, and frame stack. This is an upper bound, not a
 * typical cost - a fiber carves these spans up front today (the Phase 3b
 * stack-discipline allocator), and the general segment arena that carves only a
 * fiber's actual live depth lands with the async load. Most root-rule fibers
 * run to completion within a tick and free their segments at the next sweep, so
 * the live count - not the count cap - drives arena pressure.
 */
inline constexpr uint32_t kPerFiberSegmentBytes =
    kMaxStackSize * sizeof(Value) + kMaxLocalsSize * sizeof(Value) + kMaxFrameDepth * sizeof(Frame);

/**
 * Arena bytes needed to hold a decoded program image plus `peakLiveFibers`
 * fibers carved at the per-fiber ceilings concurrently. A target provisions its
 * arena for the realistic peak of concurrently live root-rule fibers (not the
 * {@link kMaxLiveFibers} count cap); a brain that exceeds the provisioned arena
 * faults `ErrorCode::StackOverflow` loudly at spawn rather than overrunning.
 */
inline constexpr uint32_t vmArenaBytesFor(uint32_t imageBytes, uint32_t peakLiveFibers) {
  return imageBytes + peakLiveFibers * kPerFiberSegmentBytes;
}

/**
 * Recommended single-arena size for the button-display slice and small brains.
 * Holds a several-KiB program image plus a handful of concurrently live fibers
 * at the per-fiber ceilings, leaving the bulk of a 128 KiB-SRAM class device's
 * RAM to the CODAL runtime, the C stack, and CODAL's heap. The firmware may
 * grow this toward the free SRAM ceiling; the segment-depth work shrinks the
 * per-fiber term so the same arena holds far more concurrent fibers.
 */
inline constexpr uint32_t kRecommendedVmArenaBytes = 48u * 1024u;

} // namespace mindcraft
