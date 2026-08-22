#pragma once

#include "codal/device-port.h"
#include "codal/fault-mode.h"
#include "core/runtime/brain-runtime.h"
#include "core/runtime/error-code.h"
#include "core/runtime/result.h"

namespace wendoo {

/**
 * The board-agnostic on-device host loop: the single VM entry point that
 * sources time through the device clock port and drives one
 * {@link BrainRuntime} think per tick. It drives the board only through the
 * abstract {@link DevicePorts}; a target wires the concrete ports and calls
 * {@link tick} repeatedly.
 *
 * Cadence the loop guarantees `think()`:
 * - One think per {@link tick}, and the loop is the sole caller of `think()`
 *   (the single-entry rule; host callbacks and action bodies never re-enter it).
 * - Time is read once per tick from {@link MonotonicClockPort::uptimeMillis}
 *   and forwarded unmodified. The dt rule and the time/dt/tick stamping live in
 *   {@link BrainRuntime}; the loop supplies the clock reading.
 *
 * Fault mode: on an unrecoverable condition - a failed page activation at
 * {@link startup} or a think that faults - the loop latches fault mode, stops
 * ticking the brain, and thereafter renders the device fault display each tick
 * ({@link showFaultPass}: the fault face, then the diagnostic code). A per-fiber
 * script fault does not latch fault mode: it returns an ok think status, so the
 * loop keeps ticking.
 */
class HostLoop {
public:
  /**
   * A loop ticking `brain` and driving `ports`. Every port pointer in `ports`
   * must be non-null and outlive the loop.
   */
  HostLoop(BrainRuntime& brain, DevicePorts ports);

  /**
   * Activates the brain ({@link BrainRuntime::startup}). On failure, latches
   * fault mode in the runtime domain and returns the failing status; {@link
   * tick} then renders the fault display instead of ticking. Call once before
   * {@link tick}.
   */
  Status startup();

  /**
   * One host-loop iteration. While running: reads the clock and drives one
   * think; a faulting think latches fault mode and renders the fault display
   * on this same tick. While faulted: renders one fault-display pass.
   */
  void tick();

  /** True once the loop has latched fault mode. */
  bool faulted() const { return faulted_; }

  /** The latched fault code. Meaningful only when {@link faulted} is true. */
  ErrorCode faultCode() const { return faultCode_; }

private:
  void enterFault(ErrorCode code);

  BrainRuntime& brain_;
  DevicePorts ports_;
  bool faulted_ = false;
  ErrorCode faultCode_ = ErrorCode::HostError;
  char faultCodeText_[kFaultCodeSize] = {};
};

} // namespace wendoo
