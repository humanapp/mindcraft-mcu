#include "core/runtime/fiber-scheduler.h"

#include "core/runtime/execution-context.h"

namespace mindcraft {

FiberScheduler::FiberScheduler(const ProgramImage& program, const RuntimeSurface& surface,
                               RegionArena& arena)
    : program_(program), surface_(surface), arena_(arena), records_(arena), regions_(arena) {
  // The scheduler is the heap's root source; point the surface the dispatch
  // loop runs against back at it so an allocation can collect over all fibers.
  surface_.roots = this;
}

void FiberScheduler::enumerateRoots(GcMarker& marker) {
  records_.forEachLive([&marker](FiberRecord& record) {
    const ExecutionState& exec = record.exec;
    for (uint32_t i = 0; i < exec.stackDepth; i++) {
      marker.mark(exec.stack[i]);
    }
    for (uint32_t i = 0; i < exec.localsDepth; i++) {
      marker.mark(exec.locals[i]);
    }
  });
  if (surface_.context != nullptr) {
    const ExecutionContext& ctx = *surface_.context;
    for (size_t i = 0; i < ctx.variables.size(); i++) {
      marker.mark(ctx.variables[i]);
    }
    for (size_t i = 0; i < ctx.callSiteStates.size(); i++) {
      if (ctx.callSiteStatePresent[i]) {
        marker.mark(ctx.callSiteStates[i]);
      }
    }
    for (size_t i = 0; i < ctx.callSiteSlots.size(); i++) {
      marker.mark(ctx.callSiteSlots[i]);
    }
  }
}

FiberRecord* FiberScheduler::allocFiber(uint32_t funcId, ErrorCode& err) {
  if (records_.liveCount() >= kMaxFibers) {
    err = ErrorCode::StackOverflow;
    return nullptr;
  }

  // Reserve the four execution regions at their initial sizes; they grow on
  // demand toward the caps. A failed reserve releases whatever already landed.
  ExecutionState exec{};
  exec.allocator = &regions_;
  exec.stackLimit = kMaxStackSize;
  exec.localsLimit = kMaxLocalsSize;
  exec.frameLimit = kMaxFrameDepth;
  exec.handlerLimit = kMaxHandlers;
  exec.stack = regions_.reserve<Value>(kInitialStackSlots);
  exec.locals = regions_.reserve<Value>(kInitialLocalsSlots);
  exec.frames = regions_.reserve<Frame>(kInitialFrameSlots);
  exec.handlers = regions_.reserve<Handler>(kInitialHandlerSlots);
  if (exec.stack == nullptr || exec.locals == nullptr || exec.frames == nullptr ||
      exec.handlers == nullptr) {
    exec.stackCapacity = exec.stack != nullptr ? kInitialStackSlots : 0;
    exec.localsCapacity = exec.locals != nullptr ? kInitialLocalsSlots : 0;
    exec.frameCapacity = exec.frames != nullptr ? kInitialFrameSlots : 0;
    exec.handlerCapacity = exec.handlers != nullptr ? kInitialHandlerSlots : 0;
    releaseRegions(exec);
    err = ErrorCode::StackOverflow;
    return nullptr;
  }
  exec.stackCapacity = kInitialStackSlots;
  exec.localsCapacity = kInitialLocalsSlots;
  exec.frameCapacity = kInitialFrameSlots;
  exec.handlerCapacity = kInitialHandlerSlots;

  FiberRecord* record = records_.alloc();
  if (record == nullptr) {
    releaseRegions(exec);
    err = ErrorCode::StackOverflow;
    return nullptr;
  }

  const Status started = startExecution(exec, program_, funcId, {});
  if (!started.isOk()) {
    records_.free(record);
    releaseRegions(exec);
    err = started.error();
    return nullptr;
  }

  record->id = nextFiberId_++;
  record->state = FiberState::Runnable;
  record->exec = exec;
  return record;
}

Result<uint32_t> FiberScheduler::spawn(uint32_t funcId) {
  ErrorCode err = ErrorCode::StackOverflow;
  FiberRecord* record = allocFiber(funcId, err);
  if (record == nullptr) {
    return Result<uint32_t>::fail(err);
  }
  enqueue(record);
  return Result<uint32_t>::ok(record->id);
}

Status FiberScheduler::runActionHook(uint32_t funcId, uint32_t actionId, uint32_t callSiteId) {
  ErrorCode err = ErrorCode::StackOverflow;
  FiberRecord* record = allocFiber(funcId, err);
  if (record == nullptr) {
    return Status::fail(err);
  }
  // Mark the entry frame as a sync action frame bound to this action and call
  // site.
  record->exec.frames[0].hasActionBinding = true;
  record->exec.frames[0].actionBinding = ActionFrameBinding{actionId, callSiteId, false};

  record->exec.budget = kHookBudget;
  const RunResult result = runExecution(record->exec, program_, surface_);

  Status status = Status::ok();
  switch (result.status) {
  case RunStatus::Done:
    break;
  case RunStatus::Fault:
    status = Status::fail(result.error);
    break;
  case RunStatus::Yielded:
  case RunStatus::Waiting:
    // A hook that did not complete in its single slice cannot suspend.
    status = Status::fail(ErrorCode::ScriptError);
    break;
  }

  releaseRegions(record->exec);
  records_.free(record);
  return status;
}

void FiberScheduler::releaseRegions(ExecutionState& exec) {
  regions_.release<Value>(exec.stack, exec.stackCapacity);
  regions_.release<Value>(exec.locals, exec.localsCapacity);
  regions_.release<Frame>(exec.frames, exec.frameCapacity);
  regions_.release<Handler>(exec.handlers, exec.handlerCapacity);
  exec.stack = nullptr;
  exec.locals = nullptr;
  exec.frames = nullptr;
  exec.handlers = nullptr;
}

void FiberScheduler::cancel(uint32_t fiberId) {
  FiberRecord* record = findFiber(fiberId);
  if (record == nullptr ||
      (record->state != FiberState::Runnable && record->state != FiberState::Waiting)) {
    return;
  }
  record->state = FiberState::Cancelled;
  // A cancelled record must leave the run queue before a sweep can free it.
  removeFromQueue(record);
}

uint32_t FiberScheduler::tick() {
  uint32_t executed = 0;
  // Round snapshot: only the fibers queued at entry run; mid-round enqueues
  // stay queued for the next round.
  const uint32_t roundSize = queueCount_;
  for (uint32_t i = 0; i < roundSize; i++) {
    FiberRecord* record = dequeue();
    if (record->state != FiberState::Runnable) {
      continue;
    }

    record->exec.budget = kDefaultBudget;
    const RunResult result = runExecution(record->exec, program_, surface_);
    switch (result.status) {
    case RunStatus::Yielded:
      enqueue(record);
      break;
    case RunStatus::Done:
      record->state = FiberState::Done;
      break;
    case RunStatus::Fault:
      record->state = FiberState::Fault;
      if (surface_.observer != nullptr) {
        surface_.observer->onFiberFault(record->id, result.error);
      }
      break;
    case RunStatus::Waiting:
      // No async capability exists, so a Waiting slice is a host-contract
      // violation: fault the fiber loudly rather than parking it.
      record->state = FiberState::Fault;
      if (surface_.observer != nullptr) {
        surface_.observer->onFiberFault(record->id, ErrorCode::HostError);
      }
      break;
    }
    executed++;
  }
  return executed;
}

void FiberScheduler::sweep() {
  records_.forEachLive([&](FiberRecord& record) {
    if (record.state == FiberState::Done || record.state == FiberState::Fault ||
        record.state == FiberState::Cancelled) {
      releaseRegions(record.exec);
      records_.free(&record);
    }
  });
}

const FiberRecord* FiberScheduler::fiber(uint32_t fiberId) const {
  return const_cast<FiberScheduler*>(this)->findFiber(fiberId);
}

uint32_t FiberScheduler::liveCount() const { return records_.liveCount(); }

FiberRecord* FiberScheduler::findFiber(uint32_t fiberId) {
  FiberRecord* found = nullptr;
  records_.forEachLive([&](FiberRecord& record) {
    if (record.id == fiberId) {
      found = &record;
    }
  });
  return found;
}

void FiberScheduler::enqueue(FiberRecord* record) {
  record->nextRunnable = nullptr;
  if (runTail_ != nullptr) {
    runTail_->nextRunnable = record;
  } else {
    runHead_ = record;
  }
  runTail_ = record;
  queueCount_++;
}

FiberRecord* FiberScheduler::dequeue() {
  FiberRecord* record = runHead_;
  runHead_ = record->nextRunnable;
  if (runHead_ == nullptr) {
    runTail_ = nullptr;
  }
  record->nextRunnable = nullptr;
  queueCount_--;
  return record;
}

void FiberScheduler::removeFromQueue(FiberRecord* record) {
  FiberRecord* prev = nullptr;
  for (FiberRecord* cur = runHead_; cur != nullptr; cur = cur->nextRunnable) {
    if (cur == record) {
      if (prev != nullptr) {
        prev->nextRunnable = cur->nextRunnable;
      } else {
        runHead_ = cur->nextRunnable;
      }
      if (runTail_ == cur) {
        runTail_ = prev;
      }
      cur->nextRunnable = nullptr;
      queueCount_--;
      return;
    }
    prev = cur;
  }
}

} // namespace mindcraft
