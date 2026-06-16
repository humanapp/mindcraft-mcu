#include "doctest/doctest.h"

#include "core/runtime/core-host-actions.h"
#include "core/runtime/core-host-functions.h"
#include "core/runtime/execution-context.h"
#include "core/runtime/host-action.h"
#include "core/runtime/host-actions/core-host-action-bindings.h"
#include "core/runtime/value.h"

#include <cstdint>
#include <iterator>

using mindcraft::CoreFuncId;
using mindcraft::CoreHostActionEnv;
using mindcraft::ExecutionContext;
using mindcraft::findHostActionById;
using mindcraft::HostActionBinding;
using mindcraft::kCoreHostActions;
using mindcraft::makeCoreHostActionBindings;
using mindcraft::Span;
using mindcraft::TARGET_ACTION_ID_BASE;
using mindcraft::Value;
using mindcraft::VmRng;
namespace CoreHostActions = mindcraft::CoreHostActions;

TEST_CASE("action partition constant matches the TS declaration") {
  CHECK(TARGET_ACTION_ID_BASE == 1024);
}

TEST_CASE("core host-action ids are wire-stable") {
  CHECK(CoreHostActions::SwitchPage.actionId == 0);
  CHECK(CoreHostActions::RestartPage.actionId == 1);
  CHECK(CoreHostActions::Yield.actionId == 2);
  CHECK(CoreHostActions::Random.actionId == 3);
  CHECK(CoreHostActions::OnPageEntered.actionId == 4);
  CHECK(CoreHostActions::Timeout.actionId == 5);
  CHECK(CoreHostActions::CurrentPage.actionId == 6);
  CHECK(CoreHostActions::PreviousPage.actionId == 7);
}

TEST_CASE("core host-action fnIds reference the declared core funcIds") {
  CHECK(CoreHostActions::SwitchPage.fnId == static_cast<uint32_t>(CoreFuncId::ActuatorSwitchPage));
  CHECK(CoreHostActions::SwitchPage.fnId == 57);
  CHECK(CoreHostActions::RestartPage.fnId == 58);
  CHECK(CoreHostActions::Yield.fnId == 59);
  CHECK(CoreHostActions::Random.fnId == 52);
  CHECK(CoreHostActions::OnPageEntered.fnId == 53);
  CHECK(CoreHostActions::Timeout.fnId == 54);
  CHECK(CoreHostActions::CurrentPage.fnId == 55);
  CHECK(CoreHostActions::PreviousPage.fnId == 56);
}

TEST_CASE("record table covers every action densely in action-id order") {
  REQUIRE(std::size(kCoreHostActions) == 8);
  for (uint32_t i = 0; i < std::size(kCoreHostActions); i++) {
    CHECK(kCoreHostActions[i].actionId == i);
    CHECK(kCoreHostActions[i].actionId < TARGET_ACTION_ID_BASE);
  }
}

TEST_CASE("the random sensor yields the surface rng stream") {
  VmRng rng;
  VmRng reference;
  CoreHostActionEnv env;
  env.rng = &rng;
  auto bindings = makeCoreHostActionBindings(env);
  const HostActionBinding* random =
      findHostActionById({bindings.data(), bindings.size()}, CoreHostActions::Random.actionId);
  REQUIRE(random != nullptr);

  ExecutionContext ctx;
  for (int i = 0; i < 4; i++) {
    const Value result = random->execSync(random->hostData, ctx, Span<const Value>{});
    REQUIRE(result.isNumber());
    CHECK(result.asNumber() == reference.next());
  }
}
