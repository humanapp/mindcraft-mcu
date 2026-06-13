#pragma once

#include <array>
#include <cstdint>

#include "core/runtime/mc-number.h"
#include "core/runtime/value.h"

namespace mindcraft {

/** Sentinel call-site id marking execution outside any host-call dispatch. */
inline constexpr uint32_t kNoCallSiteId = 0xffffffffu;

/**
 * Number of per-callsite host-state slots. Call-site ids at or above this
 * fault `ErrorCode::HostError` when a host dispatch binds them.
 */
inline constexpr uint32_t kMaxCallSiteStates = 64;

/**
 * Number of brain variable slots. A program whose variable table addresses a
 * slot at or above this faults `ErrorCode::HostError` at the access.
 */
inline constexpr uint32_t kMaxBrainVariables = 64;

/**
 * Brain-wide runtime state one execution observes: the think-loop time
 * stamps, the bound call site of an in-flight host dispatch, per-callsite
 * host state, and the brain variable slots. Mirrors the runtime-state surface
 * of `ExecutionContext` in
 * external/mindcraft-lang/packages/core/src/runtime/context.ts for the
 * implemented opcode subset.
 */
struct ExecutionContext {
  /** Current think time in milliseconds. Stamped before each tick. */
  mc_number_t time = 0;

  /**
   * Milliseconds since the previous think; 0 until a previous think exists.
   * Stamped before each tick.
   */
  mc_number_t dt = 0;

  /** Current tick number. Incremented on each think. */
  uint32_t currentTick = 0;

  /**
   * Call-site id of the in-flight host dispatch, or {@link kNoCallSiteId}
   * outside one. Bound by the VM before invoking a host-action body.
   */
  uint32_t currentCallSiteId = kNoCallSiteId;

  /** Brain variable slots, nil until stored. */
  std::array<Value, kMaxBrainVariables> variables{};

  /** Per-callsite host-state slots, keyed by call-site id. */
  std::array<Value, kMaxCallSiteStates> callSiteStates{};

  /** Present flags for {@link callSiteStates}; false reads as no state. */
  std::array<bool, kMaxCallSiteStates> callSiteStatePresent{};

  /**
   * True when the current call site holds host state. Requires
   * {@link currentCallSiteId} to be bound and within
   * {@link kMaxCallSiteStates}.
   */
  bool hasCallSiteState() const { return callSiteStatePresent[currentCallSiteId]; }

  /**
   * The host state of the current call site. Meaningful only when
   * {@link hasCallSiteState} is true.
   */
  const Value& callSiteState() const { return callSiteStates[currentCallSiteId]; }

  /** Writes the host state of the current call site. */
  void setCallSiteState(const Value& value) {
    callSiteStates[currentCallSiteId] = value;
    callSiteStatePresent[currentCallSiteId] = true;
  }

  /** Drops the host state of the current call site. */
  void clearCallSiteState() {
    callSiteStates[currentCallSiteId] = kNilValue;
    callSiteStatePresent[currentCallSiteId] = false;
  }
};

} // namespace mindcraft
