#include "core/runtime/fiber-scheduler.h"

namespace mindcraft {

FiberScheduler::FiberScheduler(const ProgramImage& program, const RuntimeSurface& surface,
                               RegionArena& arena)
    : program_(program), surface_(surface), arena_(arena) {}

Result<uint32_t> FiberScheduler::spawn(uint32_t funcId) {
  FiberRecord* record = nullptr;
  for (FiberRecord& candidate : records_) {
    if (!candidate.inUse) {
      record = &candidate;
      break;
    }
  }
  if (record == nullptr) {
    return Result<uint32_t>::fail(ErrorCode::StackOverflow);
  }

  // Carve this fiber's three segments above the arena's high-water; on any
  // shortfall roll the whole fiber's carve back so the arena is unchanged.
  const RegionArena::Mark mark = arena_.mark();
  Value* stack = arena_.carve<Value>(kMaxStackSize);
  Value* locals = arena_.carve<Value>(kMaxLocalsSize);
  Frame* frames = arena_.carve<Frame>(kMaxFrameDepth);
  if (stack == nullptr || locals == nullptr || frames == nullptr) {
    arena_.releaseTo(mark);
    return Result<uint32_t>::fail(ErrorCode::StackOverflow);
  }

  ExecutionState exec{};
  exec.stack = stack;
  exec.stackLimit = kMaxStackSize;
  exec.locals = locals;
  exec.localsLimit = kMaxLocalsSize;
  exec.frames = frames;
  exec.frameLimit = kMaxFrameDepth;
  const Status started = startExecution(exec, program_, funcId, {});
  if (!started.isOk()) {
    arena_.releaseTo(mark);
    return Result<uint32_t>::fail(started.error());
  }

  const uint32_t fiberId = nextFiberId_++;
  record->inUse = true;
  record->id = fiberId;
  record->state = FiberState::Runnable;
  record->exec = exec;
  record->regionMark = mark;
  enqueue(fiberId);
  return Result<uint32_t>::ok(fiberId);
}

void FiberScheduler::cancel(uint32_t fiberId) {
  FiberRecord* record = findFiber(fiberId);
  if (record != nullptr &&
      (record->state == FiberState::Runnable || record->state == FiberState::Waiting)) {
    record->state = FiberState::Cancelled;
  }
}

uint32_t FiberScheduler::tick() {
  uint32_t executed = 0;
  // Round snapshot: only the fibers queued at entry run; mid-round enqueues
  // stay queued for the next round.
  const uint32_t roundSize = queueCount_;
  for (uint32_t i = 0; i < roundSize; i++) {
    const uint32_t fiberId = dequeue();
    FiberRecord* record = findFiber(fiberId);
    if (record == nullptr || record->state != FiberState::Runnable) {
      continue;
    }

    record->exec.budget = kDefaultBudget;
    const RunResult result = runExecution(record->exec, program_, surface_);
    switch (result.status) {
    case RunStatus::Yielded:
      enqueue(fiberId);
      break;
    case RunStatus::Done:
      record->state = FiberState::Done;
      break;
    case RunStatus::Fault:
      record->state = FiberState::Fault;
      if (surface_.observer != nullptr) {
        surface_.observer->onFiberFault(fiberId, result.error);
      }
      break;
    case RunStatus::Waiting:
      // No async capability exists, so a Waiting slice is a host-contract
      // violation: fault the fiber loudly rather than parking it.
      record->state = FiberState::Fault;
      if (surface_.observer != nullptr) {
        surface_.observer->onFiberFault(fiberId, ErrorCode::HostError);
      }
      break;
    }
    executed++;
  }
  return executed;
}

void FiberScheduler::sweep() {
  for (;;) {
    // The record with the highest region mark is the most recently spawned
    // live fiber; segments release in last-carved-first order.
    FiberRecord* top = nullptr;
    for (FiberRecord& record : records_) {
      if (record.inUse && (top == nullptr || record.regionMark > top->regionMark)) {
        top = &record;
      }
    }
    if (top == nullptr || top->state == FiberState::Runnable || top->state == FiberState::Waiting) {
      return;
    }
    arena_.releaseTo(top->regionMark);
    top->inUse = false;
  }
}

const FiberRecord* FiberScheduler::fiber(uint32_t fiberId) const {
  for (const FiberRecord& record : records_) {
    if (record.inUse && record.id == fiberId) {
      return &record;
    }
  }
  return nullptr;
}

uint32_t FiberScheduler::liveCount() const {
  uint32_t count = 0;
  for (const FiberRecord& record : records_) {
    if (record.inUse) {
      count++;
    }
  }
  return count;
}

FiberRecord* FiberScheduler::findFiber(uint32_t fiberId) {
  for (FiberRecord& record : records_) {
    if (record.inUse && record.id == fiberId) {
      return &record;
    }
  }
  return nullptr;
}

void FiberScheduler::enqueue(uint32_t fiberId) {
  queue_[(queueHead_ + queueCount_) % kMaxLiveFibers] = fiberId;
  queueCount_++;
}

uint32_t FiberScheduler::dequeue() {
  const uint32_t fiberId = queue_[queueHead_];
  queueHead_ = (queueHead_ + 1) % kMaxLiveFibers;
  queueCount_--;
  return fiberId;
}

} // namespace mindcraft
