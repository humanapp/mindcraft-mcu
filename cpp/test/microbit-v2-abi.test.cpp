#include "doctest/doctest.h"

#include "core/runtime/context-field.h"
#include "core/runtime/core-type-atom-id.h"
#include "targets/microbit-v2/abi/host-actions.h"
#include "targets/microbit-v2/abi/host-func-id.h"
#include "targets/microbit-v2/abi/microbit-field.h"
#include "targets/microbit-v2/abi/type-atom-id.h"

#include <cstdint>
#include <iterator>

using mindcraft::CONTEXT_MICROBIT_FIELD_ID;
using mindcraft::kContextFieldCount;
using mindcraft::kMicroBitFieldCount;
using mindcraft::kMicroBitV2HostActions;
using mindcraft::kMicroBitV2HostFuncIdCount;
using mindcraft::kMicroBitV2TypeAtomIdCount;
using mindcraft::MicroBitField;
using mindcraft::MicroBitV2HostFuncId;
using mindcraft::MicroBitV2TypeAtomId;
using mindcraft::TARGET_ACTION_ID_BASE;
using mindcraft::TARGET_FUNC_ID_BASE;
using mindcraft::TARGET_TYPE_ATOM_BASE;
namespace MicroBitV2HostActions = mindcraft::MicroBitV2HostActions;

TEST_CASE("MicroBitV2HostFuncId values are wire-stable") {
  CHECK(static_cast<uint32_t>(MicroBitV2HostFuncId::DisplaySetPixelValue) == 1024);
  CHECK(static_cast<uint32_t>(MicroBitV2HostFuncId::DisplayGetPixelValue) == 1025);
  CHECK(static_cast<uint32_t>(MicroBitV2HostFuncId::DisplayClear) == 1026);
  CHECK(static_cast<uint32_t>(MicroBitV2HostFuncId::ButtonIsPressed) == 1027);
  CHECK(static_cast<uint32_t>(MicroBitV2HostFuncId::TouchButtonIsPressed) == 1028);
  CHECK(static_cast<uint32_t>(MicroBitV2HostFuncId::TouchButtonGetThreshold) == 1029);
  CHECK(static_cast<uint32_t>(MicroBitV2HostFuncId::TouchButtonSetThreshold) == 1030);
  CHECK(static_cast<uint32_t>(MicroBitV2HostFuncId::TouchButtonGetValue) == 1031);
  CHECK(static_cast<uint32_t>(MicroBitV2HostFuncId::TouchButtonSetValue) == 1032);
  CHECK(static_cast<uint32_t>(MicroBitV2HostFuncId::SensorButtonA) == 1033);
  CHECK(static_cast<uint32_t>(MicroBitV2HostFuncId::ActuatorDisplaySetPixel) == 1034);
  CHECK(static_cast<uint32_t>(MicroBitV2HostFuncId::ActuatorDisplayScroll) == 1035);
  CHECK(static_cast<uint32_t>(MicroBitV2HostFuncId::SensorButtonB) == 1036);
  CHECK(static_cast<uint32_t>(MicroBitV2HostFuncId::SensorButtonAB) == 1037);
  CHECK(static_cast<uint32_t>(MicroBitV2HostFuncId::SensorButtonLogo) == 1038);
  CHECK(kMicroBitV2HostFuncIdCount == 15);
  CHECK(static_cast<uint32_t>(MicroBitV2HostFuncId::DisplaySetPixelValue) == TARGET_FUNC_ID_BASE);
}

TEST_CASE("MicroBitV2TypeAtomId values are wire-stable") {
  CHECK(static_cast<uint32_t>(MicroBitV2TypeAtomId::MicroBitDisplay) == 1024);
  CHECK(static_cast<uint32_t>(MicroBitV2TypeAtomId::Button) == 1025);
  CHECK(static_cast<uint32_t>(MicroBitV2TypeAtomId::TouchButton) == 1026);
  CHECK(static_cast<uint32_t>(MicroBitV2TypeAtomId::MicroBit) == 1027);
  CHECK(kMicroBitV2TypeAtomIdCount == 4);
  CHECK(static_cast<uint32_t>(MicroBitV2TypeAtomId::MicroBitDisplay) == TARGET_TYPE_ATOM_BASE);
}

TEST_CASE("microbit-v2 host-action ids are wire-stable") {
  CHECK(MicroBitV2HostActions::ButtonA.actionId == 1024);
  CHECK(MicroBitV2HostActions::ButtonA.fnId ==
        static_cast<uint32_t>(MicroBitV2HostFuncId::SensorButtonA));
  CHECK(MicroBitV2HostActions::ButtonA.fnId == 1033);
  CHECK(MicroBitV2HostActions::DisplaySetPixel.actionId == 1025);
  CHECK(MicroBitV2HostActions::DisplaySetPixel.fnId ==
        static_cast<uint32_t>(MicroBitV2HostFuncId::ActuatorDisplaySetPixel));
  CHECK(MicroBitV2HostActions::DisplaySetPixel.fnId == 1034);
  CHECK(MicroBitV2HostActions::DisplayScroll.actionId == 1026);
  CHECK(MicroBitV2HostActions::DisplayScroll.fnId ==
        static_cast<uint32_t>(MicroBitV2HostFuncId::ActuatorDisplayScroll));
  CHECK(MicroBitV2HostActions::DisplayScroll.fnId == 1035);
  CHECK(MicroBitV2HostActions::ButtonB.actionId == 1027);
  CHECK(MicroBitV2HostActions::ButtonB.fnId ==
        static_cast<uint32_t>(MicroBitV2HostFuncId::SensorButtonB));
  CHECK(MicroBitV2HostActions::ButtonAB.actionId == 1028);
  CHECK(MicroBitV2HostActions::ButtonAB.fnId ==
        static_cast<uint32_t>(MicroBitV2HostFuncId::SensorButtonAB));
  CHECK(MicroBitV2HostActions::ButtonLogo.actionId == 1029);
  CHECK(MicroBitV2HostActions::ButtonLogo.fnId ==
        static_cast<uint32_t>(MicroBitV2HostFuncId::SensorButtonLogo));

  REQUIRE(std::size(kMicroBitV2HostActions) == 6);
  for (uint32_t i = 0; i < std::size(kMicroBitV2HostActions); i++) {
    CHECK(kMicroBitV2HostActions[i].actionId == TARGET_ACTION_ID_BASE + i);
  }
}

TEST_CASE("MicroBitField values are wire-stable") {
  CHECK(static_cast<uint8_t>(MicroBitField::Display) == 0);
  CHECK(static_cast<uint8_t>(MicroBitField::ButtonA) == 1);
  CHECK(static_cast<uint8_t>(MicroBitField::ButtonB) == 2);
  CHECK(static_cast<uint8_t>(MicroBitField::Logo) == 3);
  CHECK(kMicroBitFieldCount == 4);
}

TEST_CASE("the Context.microbit extension id sits just above the core Context fields") {
  CHECK(CONTEXT_MICROBIT_FIELD_ID == 6);
  CHECK(CONTEXT_MICROBIT_FIELD_ID == kContextFieldCount);
}
