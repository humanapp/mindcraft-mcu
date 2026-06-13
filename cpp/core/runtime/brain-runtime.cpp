#include "core/runtime/brain-runtime.h"

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
  // Bind the brain-lifetime slot tables from the shared region, sized to the
  // program: one slot per declared variable, and one call-site state slot per
  // distinct call-site id.
  uint32_t callSiteCount = 0;
  for (const ActionCallSite& site : program_.callSites) {
    if (site.callSiteId + 1 > callSiteCount) {
      callSiteCount = site.callSiteId + 1;
    }
  }
  const uint32_t variableCount = static_cast<uint32_t>(program_.variableNames.size());
  if (!surface_.context->bindSlots(scheduler_.arena(), variableCount, callSiteCount)) {
    return Status::fail(ErrorCode::HostError);
  }
  lastThinkTime_ = 0;
  if (program_.pages.empty()) {
    return Status::ok();
  }
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
    if (site.binding != CallSiteBinding::Host) {
      continue;
    }
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

Status BrainRuntime::think(mc_number_t currentTimeMs) {
  if (inThink_) {
    return Status::fail(ErrorCode::HostError);
  }
  if (!pageActive_) {
    return Status::ok();
  }
  inThink_ = true;

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
  scheduler_.sweep();

  lastThinkTime_ = currentTimeMs;
  inThink_ = false;
  return Status::ok();
}

} // namespace mindcraft
