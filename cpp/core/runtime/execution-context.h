#pragma once

#include <cstddef>
#include <cstdint>

#include "core/platform/span.h"
#include "core/runtime/mc-number.h"
#include "core/runtime/region-arena.h"
#include "core/runtime/value.h"

namespace mindcraft {

/** Sentinel call-site id marking execution outside any host-call dispatch. */
inline constexpr uint32_t kNoCallSiteId = 0xffffffffu;

/**
 * Brain-wide runtime state one execution observes: the think-loop time
 * stamps, the bound call site of an in-flight host dispatch, per-callsite
 * host state, and the brain variable slots. Mirrors the runtime-state surface
 * of `ExecutionContext` in
 * external/mindcraft-lang/packages/core/src/runtime/context.ts for the
 * implemented opcode subset.
 *
 * The slot tables are sized to the loaded program and drawn from the shared
 * region by {@link bindSlots} (the brain runtime binds them at startup); they
 * are empty until then. A slot access past a table's size is a host-contract
 * violation the VM faults `ErrorCode::HostError`.
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

  /** Brain variable slots, nil until stored. Sized by {@link bindSlots}. */
  Span<Value> variables{};

  /** Per-callsite host-state slots, keyed by call-site id. */
  Span<Value> callSiteStates{};

  /** Present flags for {@link callSiteStates}; false reads as no state. */
  Span<bool> callSiteStatePresent{};

  /**
   * Allocates the slot tables from `arena`: `variableCount` brain-variable
   * slots (initialized to nil) and `callSiteCount` per-callsite state slots
   * (initially absent). Returns false when the arena cannot back them, leaving
   * the tables empty.
   */
  bool bindSlots(RegionArena& arena, uint32_t variableCount, uint32_t callSiteCount) {
    Value* vars = arena.allocate<Value>(variableCount);
    Value* states = arena.allocate<Value>(callSiteCount);
    bool* present = arena.allocate<bool>(callSiteCount);
    if ((variableCount > 0 && vars == nullptr) ||
        (callSiteCount > 0 && (states == nullptr || present == nullptr))) {
      return false;
    }
    for (uint32_t i = 0; i < variableCount; i++) {
      vars[i] = kNilValue;
    }
    variables = {vars, variableCount};
    callSiteStates = {states, callSiteCount};
    callSiteStatePresent = {present, callSiteCount};
    return true;
  }

  /**
   * True when the current call site holds host state. Requires
   * {@link currentCallSiteId} to be bound and within {@link callSiteStates}.
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
