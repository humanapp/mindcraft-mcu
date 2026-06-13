#pragma once

#include <array>
#include <cstdint>

#include "core/runtime/fiber-scheduler.h"
#include "core/runtime/mc-number.h"
#include "core/runtime/program.h"
#include "core/runtime/result.h"
#include "core/runtime/vm.h"

namespace mindcraft {

/** Root-rule capacity of one page's activation. */
inline constexpr uint32_t kMaxPageRootRules = 16;

/**
 * The brain think loop over one active page: page activation, per-think rule
 * fiber respawn, and time stamping. Mirrors the `startup`/`think` flow of
 * `BrainRuntime` in
 * external/mindcraft-lang/packages/core/src/runtime/brain-runtime.ts for a
 * single-page program.
 *
 * Single-entry: only the host loop may call {@link think}; host callbacks
 * and action bodies must never re-enter it.
 */
class BrainRuntime {
public:
  /**
   * A runtime ticking `program` on `scheduler` against `surface`, whose
   * `context` must be non-null. All referenced objects must outlive the
   * runtime.
   */
  BrainRuntime(const ProgramImage& program, FiberScheduler& scheduler,
               const RuntimeSurface& surface);

  /**
   * Begins execution: activates page 0, running each host call site's
   * page-entered hook with the call site bound, then spawning the page's
   * root-rule fibers in order. A program with no pages activates nothing.
   * Call once before {@link think}. Fails with `ErrorCode::HostError` when
   * the surface has no context, a call-site id or the root-rule count
   * exceeds its capacity; spawn failures propagate.
   */
  Status startup();

  /**
   * Advances the brain by one think. Stamps `time`, `dt` (0 until a previous
   * think exists, the difference otherwise), and the tick counter on the
   * execution context, respawns every completed, faulted, or cancelled rule
   * fiber, and runs one scheduler round followed by a reclaim sweep. A
   * no-op when no page is active. Fails with `ErrorCode::HostError` on
   * re-entry; spawn failures propagate.
   *
   * @param currentTimeMs - Monotonically increasing time in milliseconds.
   */
  Status think(mc_number_t currentTimeMs);

private:
  Status activatePage(uint32_t pageIndex);

  /** One root rule of the active page and its current fiber. */
  struct RuleFiber {
    uint32_t funcId;
    uint32_t fiberId;
  };

  const ProgramImage& program_;
  FiberScheduler& scheduler_;
  RuntimeSurface surface_;
  std::array<RuleFiber, kMaxPageRootRules> ruleFibers_{};
  uint32_t ruleFiberCount_ = 0;
  bool pageActive_ = false;
  bool inThink_ = false;
  mc_number_t lastThinkTime_ = 0;
};

} // namespace mindcraft
