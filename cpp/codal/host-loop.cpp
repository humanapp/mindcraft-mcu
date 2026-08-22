#include "codal/host-loop.h"

#include "core/runtime/mc-number.h"

namespace wendoo {

HostLoop::HostLoop(BrainRuntime& brain, DevicePorts ports) : brain_(brain), ports_(ports) {}

Status HostLoop::startup() {
  const Status status = brain_.startup();
  if (!status.isOk()) {
    enterFault(status.error());
  }
  return status;
}

void HostLoop::tick() {
  if (!faulted_) {
    const uint32_t nowMs = ports_.clock->uptimeMillis();
    const Status status = brain_.think(static_cast<mc_number_t>(nowMs));
    if (!status.isOk()) {
      enterFault(status.error());
    }
  }
  if (faulted_) {
    showFaultPass(*ports_.faultDisplay, faultCodeText_);
  }
}

void HostLoop::enterFault(ErrorCode code) {
  faulted_ = true;
  faultCode_ = code;
  formatFaultCode(faultCodeText_, FaultDomain::Runtime, static_cast<uint16_t>(code));
}

} // namespace wendoo
