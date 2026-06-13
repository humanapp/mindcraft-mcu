#include "core/runtime/fiber-scheduler.h"

namespace mindcraft {

FiberScheduler::FiberScheduler(const ProgramImage& program, const RuntimeSurface& surface,
                               RegionArena& arena)
    : program_(program), surface_(surface), arena_(arena), records_(arena), workspaces_(arena) {}

Result<uint32_t> FiberScheduler::spawn(uint32_t funcId) {
  if (records_.liveCount() >= kMaxFibers) {
    return Result<uint32_t>::fail(ErrorCode::StackOverflow);
  }
  FiberWorkspace* workspace = workspaces_.alloc();
  if (workspace == nullptr) {
    return Result<uint32_t>::fail(ErrorCode::StackOverflow);
  }
  FiberRecord* record = records_.alloc();
  if (record == nullptr) {
    workspaces_.free(workspace);
    return Result<uint32_t>::fail(ErrorCode::StackOverflow);
  }

  ExecutionState exec{};
  exec.stack = workspace->stack;
  exec.stackLimit = kMaxStackSize;
  exec.locals = workspace->locals;
  exec.localsLimit = kMaxLocalsSize;
  exec.frames = workspace->frames;
  exec.frameLimit = kMaxFrameDepth;
  const Status started = startExecution(exec, program_, funcId, {});
  if (!started.isOk()) {
    records_.free(record);
    workspaces_.free(workspace);
    return Result<uint32_t>::fail(started.error());
  }

  const uint32_t fiberId = nextFiberId_++;
  record->id = fiberId;
  record->state = FiberState::Runnable;
  record->exec = exec;
  record->workspace = workspace;
  enqueue(record);
  return Result<uint32_t>::ok(fiberId);
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
      workspaces_.free(record.workspace);
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
