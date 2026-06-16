#include "core/runtime/brain-runtime.h"

#include <cstring>

#include "core/runtime/execution-context.h"
#include "core/runtime/host-action.h"

namespace mindcraft {

BrainRuntime::BrainRuntime(const ProgramImage& program, FiberScheduler& scheduler,
                           const RuntimeSurface& surface)
    : program_(program), scheduler_(scheduler), surface_(surface) {}

Status BrainRuntime::startup() {
  if (surface_.context == nullptr) {
    return Status::fail(ErrorCode::HostError);
  }
  // Bind the brain-lifetime slot tables from the shared region: one slot per
  // declared variable, one host-state slot per distinct call-site id, and a
  // per-callsite bytecode state pad whose column count is the program's
  // largest callsite-var index plus one.
  uint32_t callSiteCount = 0;
  for (const ActionCallSite& site : program_.callSites) {
    if (site.callSiteId + 1 > callSiteCount) {
      callSiteCount = site.callSiteId + 1;
    }
  }
  uint32_t callSiteSlotStride = 0;
  for (const Instr& ins : program_.instructions) {
    if (ins.op == Op::LOAD_CALLSITE_VAR || ins.op == Op::STORE_CALLSITE_VAR) {
      if (ins.a + 1 > callSiteSlotStride) {
        callSiteSlotStride = ins.a + 1;
      }
    }
  }
  const uint32_t variableCount = static_cast<uint32_t>(program_.variableNames.size());
  if (!surface_.context->bindSlots(scheduler_.arena(), variableCount, callSiteCount,
                                   callSiteSlotStride)) {
    return Status::fail(ErrorCode::HostError);
  }
  lastThinkTime_ = 0;
  previousPageIndex_ = kNoPageIndex;
  if (program_.pages.empty()) {
    return Status::ok();
  }
  currentPageIndex_ = 0;
  desiredPageIndex_ = 0;
  return activatePage(0);
}

Status BrainRuntime::activatePage(uint32_t pageIndex) {
  const PageMetadata& page = program_.pages[pageIndex];
  ExecutionContext& ctx = *surface_.context;

  // One tracking entry per root rule, sized to the page from the shared region.
  ruleFibers_ = scheduler_.arena().allocate<RuleFiber>(page.rootRuleFuncIdsCount);
  if (page.rootRuleFuncIdsCount > 0 && ruleFibers_ == nullptr) {
    return Status::fail(ErrorCode::StackOverflow);
  }

  for (uint32_t i = 0; i < page.callSitesCount; i++) {
    const ActionCallSite& site = program_.callSites[page.callSitesOffset + i];
    if (site.binding == CallSiteBinding::Host) {
      // An unregistered action is skipped here; the existence check faults at
      // dispatch, mirroring the TS activation flow.
      const HostActionBinding* action = findHostActionById(surface_.actions, site.boundId);
      if (action == nullptr || action->onPageEntered == nullptr) {
        continue;
      }
      if (site.callSiteId >= ctx.callSiteStates.size()) {
        return Status::fail(ErrorCode::HostError);
      }
      ctx.currentCallSiteId = site.callSiteId;
      action->onPageEntered(action->hostData, ctx);
      ctx.currentCallSiteId = kNoCallSiteId;
      continue;
    }

    // Bytecode call site: run the action's one-time initializer (only the first
    // activation of this call site) and its per-activation hook, in that order.
    if (!program_.hasActions || site.boundId >= program_.actions.size()) {
      continue;
    }
    if (site.callSiteId >= ctx.callSiteAllocated.size()) {
      return Status::fail(ErrorCode::HostError);
    }
    const BytecodeAction& action = program_.actions[site.boundId];
    if (action.initializerFuncId != kNoFuncId && ctx.ensureCallSite(site.callSiteId)) {
      const Status hook =
          scheduler_.runActionHook(action.initializerFuncId, site.boundId, site.callSiteId);
      if (!hook.isOk()) {
        return hook;
      }
    }
    if (action.activationFuncId != kNoFuncId) {
      const Status hook =
          scheduler_.runActionHook(action.activationFuncId, site.boundId, site.callSiteId);
      if (!hook.isOk()) {
        return hook;
      }
    }
  }

  ruleFiberCount_ = 0;
  for (uint32_t i = 0; i < page.rootRuleFuncIdsCount; i++) {
    const uint32_t funcId = program_.rootRuleFuncIds[page.rootRuleFuncIdsOffset + i];
    const Result<uint32_t> spawned = scheduler_.spawn(funcId);
    if (!spawned.isOk()) {
      return Status::fail(spawned.error());
    }
    ruleFibers_[ruleFiberCount_++] = RuleFiber{funcId, spawned.value()};
  }

  pageActive_ = true;
  return Status::ok();
}

Status BrainRuntime::deactivateCurrentPage() {
  const PageMetadata& page = program_.pages[currentPageIndex_];
  ExecutionContext& ctx = *surface_.context;

  // Run each bytecode call site's deactivation hook in call-site order, then
  // cancel the page's rule fibers.
  for (uint32_t i = 0; i < page.callSitesCount; i++) {
    const ActionCallSite& site = program_.callSites[page.callSitesOffset + i];
    if (site.binding != CallSiteBinding::Bytecode) {
      continue;
    }
    if (!program_.hasActions || site.boundId >= program_.actions.size()) {
      continue;
    }
    const BytecodeAction& action = program_.actions[site.boundId];
    if (action.deactivationFuncId == kNoFuncId) {
      continue;
    }
    const Status hook =
        scheduler_.runActionHook(action.deactivationFuncId, site.boundId, site.callSiteId);
    if (!hook.isOk()) {
      return hook;
    }
  }

  cancelActiveFibers();
  ruleFiberCount_ = 0;
  ctx.currentCallSiteId = kNoCallSiteId;
  return Status::ok();
}

void BrainRuntime::cancelActiveFibers() {
  for (uint32_t i = 0; i < ruleFiberCount_; i++) {
    scheduler_.cancel(ruleFibers_[i].fiberId);
  }
}

void BrainRuntime::requestPageChange(uint32_t pageIndex) {
  // Out of range is a no-op; the current page stays active.
  if (pageIndex >= program_.pages.size()) {
    return;
  }
  if (pageIndex == currentPageIndex_) {
    requestPageRestart();
    return;
  }
  desiredPageIndex_ = pageIndex;
  cancelActiveFibers();
}

void BrainRuntime::requestPageRestart() { cancelActiveFibers(); }

void BrainRuntime::requestPageChangeByPageId(const char* pageId, uint32_t length) {
  for (uint32_t i = 0; i < program_.pages.size(); i++) {
    const uint32_t idx = program_.pages[i].pageIdStringIdx;
    if (idx >= program_.strings.size()) {
      continue;
    }
    const StringRef& ref = program_.strings[idx];
    if (ref.length != length) {
      continue;
    }
    const char* pageBytes = reinterpret_cast<const char*>(program_.stringData.data()) + ref.offset;
    if (length == 0 || std::memcmp(pageBytes, pageId, length) == 0) {
      requestPageChange(i);
      return;
    }
  }
}

Value BrainRuntime::getCurrentPageId() const {
  return Value::borrowedString(program_.pages[currentPageIndex_].pageIdStringIdx);
}

Value BrainRuntime::getPreviousPageId() const {
  if (previousPageIndex_ >= program_.pages.size()) {
    return getCurrentPageId();
  }
  return Value::borrowedString(program_.pages[previousPageIndex_].pageIdStringIdx);
}

Status BrainRuntime::think(mc_number_t currentTimeMs) {
  if (inThink_) {
    return Status::fail(ErrorCode::HostError);
  }
  if (!pageActive_) {
    return Status::ok();
  }
  inThink_ = true;

  // A requested page switch deactivates the current page and activates the
  // requested one before the tick's time is stamped.
  if (currentPageIndex_ != desiredPageIndex_) {
    const Status deactivated = deactivateCurrentPage();
    if (!deactivated.isOk()) {
      inThink_ = false;
      return deactivated;
    }
    previousPageIndex_ = currentPageIndex_;
    currentPageIndex_ = desiredPageIndex_;
    const Status activated = activatePage(currentPageIndex_);
    if (!activated.isOk()) {
      inThink_ = false;
      return activated;
    }
  }

  ExecutionContext& ctx = *surface_.context;
  ctx.time = currentTimeMs;
  ctx.dt = lastThinkTime_ == 0 ? 0 : currentTimeMs - lastThinkTime_;
  ctx.currentTick++;

  // A completed, faulted, or cancelled rule fiber respawns; a fault kills
  // the fiber, never the rule.
  for (uint32_t i = 0; i < ruleFiberCount_; i++) {
    RuleFiber& entry = ruleFibers_[i];
    const FiberRecord* record = scheduler_.fiber(entry.fiberId);
    const bool needsRespawn = record == nullptr || record->state == FiberState::Done ||
                              record->state == FiberState::Fault ||
                              record->state == FiberState::Cancelled;
    if (needsRespawn) {
      const Result<uint32_t> spawned = scheduler_.spawn(entry.funcId);
      if (!spawned.isOk()) {
        inThink_ = false;
        return Status::fail(spawned.error());
      }
      entry.fiberId = spawned.value();
    }
  }

  scheduler_.tick();
  // Drain any handles a host body settled during the round: resume their
  // waiters so they join the next round. An external callback may also have
  // settled a handle out of band before this think; the same drain handles it.
  scheduler_.drainCompletedHandles();
  scheduler_.sweep();

  lastThinkTime_ = currentTimeMs;
  inThink_ = false;
  return Status::ok();
}

} // namespace mindcraft
