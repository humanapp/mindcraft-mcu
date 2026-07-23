#include "doctest/doctest.h"

#include "codal/device-port.h"
#include "codal/shared-type-atom-id.h"
#include "core/runtime/context-field.h"
#include "core/runtime/core-type-atom-id.h"
#include "targets/microbit-v2/abi/host-actions.h"
#include "targets/microbit-v2/abi/host-func-id.h"
#include "targets/microbit-v2/abi/host-functions/host-func-bindings.h"
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
  CHECK(static_cast<uint32_t>(MicroBitV2HostFuncId::AccelerometerGetX) == 1039);
  CHECK(static_cast<uint32_t>(MicroBitV2HostFuncId::AccelerometerGetY) == 1040);
  CHECK(static_cast<uint32_t>(MicroBitV2HostFuncId::AccelerometerGetZ) == 1041);
  CHECK(static_cast<uint32_t>(MicroBitV2HostFuncId::AccelerometerGetPitchRadians) == 1042);
  CHECK(static_cast<uint32_t>(MicroBitV2HostFuncId::AccelerometerGetRollRadians) == 1043);
  CHECK(static_cast<uint32_t>(MicroBitV2HostFuncId::AccelerometerGetPitch) == 1044);
  CHECK(static_cast<uint32_t>(MicroBitV2HostFuncId::AccelerometerGetRoll) == 1045);
  CHECK(static_cast<uint32_t>(MicroBitV2HostFuncId::AccelerometerGetGesture) == 1046);
  CHECK(static_cast<uint32_t>(MicroBitV2HostFuncId::SensorGesture) == 1047);
  CHECK(static_cast<uint32_t>(MicroBitV2HostFuncId::ActuatorDrawImage) == 1048);
  CHECK(static_cast<uint32_t>(MicroBitV2HostFuncId::DisplayDrawImage) == 1049);
  CHECK(static_cast<uint32_t>(MicroBitV2HostFuncId::I2CWriteBuffer) == 1050);
  CHECK(static_cast<uint32_t>(MicroBitV2HostFuncId::I2CReadBuffer) == 1051);
  CHECK(static_cast<uint32_t>(MicroBitV2HostFuncId::GpioDigitalRead) == 1052);
  CHECK(static_cast<uint32_t>(MicroBitV2HostFuncId::GpioDigitalWrite) == 1053);
  CHECK(static_cast<uint32_t>(MicroBitV2HostFuncId::GpioSetPull) == 1054);
  CHECK(static_cast<uint32_t>(MicroBitV2HostFuncId::GpioServoWrite) == 1055);
  CHECK(static_cast<uint32_t>(MicroBitV2HostFuncId::SonarDistance) == 1056);
  CHECK(static_cast<uint32_t>(MicroBitV2HostFuncId::RadioSendNumber) == 1057);
  CHECK(static_cast<uint32_t>(MicroBitV2HostFuncId::RadioSendString) == 1058);
  CHECK(static_cast<uint32_t>(MicroBitV2HostFuncId::RadioSendValue) == 1059);
  CHECK(static_cast<uint32_t>(MicroBitV2HostFuncId::RadioSendBuffer) == 1060);
  CHECK(static_cast<uint32_t>(MicroBitV2HostFuncId::RadioSendRawBuffer) == 1061);
  CHECK(static_cast<uint32_t>(MicroBitV2HostFuncId::RadioSetGroup) == 1062);
  CHECK(static_cast<uint32_t>(MicroBitV2HostFuncId::RadioSetTransmitPower) == 1063);
  CHECK(static_cast<uint32_t>(MicroBitV2HostFuncId::RadioSetFrequencyBand) == 1064);
  CHECK(static_cast<uint32_t>(MicroBitV2HostFuncId::RadioReceive) == 1065);
  CHECK(static_cast<uint32_t>(MicroBitV2HostFuncId::ActuatorRadioSend) == 1066);
  CHECK(static_cast<uint32_t>(MicroBitV2HostFuncId::SensorRadioReceiveNumber) == 1067);
  CHECK(static_cast<uint32_t>(MicroBitV2HostFuncId::SensorRadioReceiveString) == 1068);
  CHECK(static_cast<uint32_t>(MicroBitV2HostFuncId::ActuatorSetRadioGroup) == 1069);
  CHECK(static_cast<uint32_t>(MicroBitV2HostFuncId::RadioCurrentSeq) == 1070);
  CHECK(static_cast<uint32_t>(MicroBitV2HostFuncId::GpioAnalogRead) == 1071);
  CHECK(static_cast<uint32_t>(MicroBitV2HostFuncId::SensorRadioReceiveBuffer) == 1072);
  CHECK(static_cast<uint32_t>(MicroBitV2HostFuncId::DisplayScrollText) == 1073);
  CHECK(static_cast<uint32_t>(MicroBitV2HostFuncId::ActuatorPlaySound) == 1074);
  CHECK(static_cast<uint32_t>(MicroBitV2HostFuncId::AudioPlaySound) == 1075);
  CHECK(static_cast<uint32_t>(MicroBitV2HostFuncId::ActuatorDisplayClear) == 1076);
  CHECK(static_cast<uint32_t>(MicroBitV2HostFuncId::DisplayGetLightLevel) == 1077);
  CHECK(static_cast<uint32_t>(MicroBitV2HostFuncId::SensorLightLevel) == 1078);
  CHECK(static_cast<uint32_t>(MicroBitV2HostFuncId::ThermometerGetTemperature) == 1079);
  CHECK(static_cast<uint32_t>(MicroBitV2HostFuncId::SensorTemperature) == 1080);
  CHECK(kMicroBitV2HostFuncIdCount == 57);
  CHECK(static_cast<uint32_t>(MicroBitV2HostFuncId::DisplaySetPixelValue) == TARGET_FUNC_ID_BASE);
}

TEST_CASE("the host-function binding table binds every declared device-API host function") {
  // The binding table closes the declared-but-unbound gap: a host function declared
  // in MicroBitV2HostFuncId but absent from the table faults at dispatch. Pin the
  // count and that DisplayClear (the device-API clear) resolves to a sync body.
  mindcraft::DevicePorts ports{};
  const auto bindings = mindcraft::makeMicroBitV2HostFuncBindings(ports);
  CHECK(bindings.size() == mindcraft::kMicroBitV2HostFuncBindingCount);
  CHECK(mindcraft::kMicroBitV2HostFuncBindingCount == 35);
  const mindcraft::TargetHostFuncBinding* clearBinding = nullptr;
  for (const auto& binding : bindings) {
    if (binding.funcId == static_cast<uint32_t>(MicroBitV2HostFuncId::DisplayClear)) {
      clearBinding = &binding;
    }
  }
  REQUIRE(clearBinding != nullptr);
  CHECK(clearBinding->exec != nullptr);
  CHECK(clearBinding->execAsync == nullptr);
}

TEST_CASE("MicroBitV2TypeAtomId values are wire-stable") {
  CHECK(static_cast<uint32_t>(MicroBitV2TypeAtomId::MicroBitDisplay) == 1024);
  CHECK(static_cast<uint32_t>(MicroBitV2TypeAtomId::Button) == 1025);
  CHECK(static_cast<uint32_t>(MicroBitV2TypeAtomId::TouchButton) == 1026);
  CHECK(static_cast<uint32_t>(MicroBitV2TypeAtomId::MicroBit) == 1027);
  CHECK(static_cast<uint32_t>(MicroBitV2TypeAtomId::Accelerometer) == 1028);
  CHECK(static_cast<uint32_t>(MicroBitV2TypeAtomId::I2C) == 1029);
  CHECK(static_cast<uint32_t>(MicroBitV2TypeAtomId::GPIO) == 1030);
  CHECK(static_cast<uint32_t>(MicroBitV2TypeAtomId::Sonar) == 1031);
  CHECK(static_cast<uint32_t>(MicroBitV2TypeAtomId::Radio) == 1032);
  CHECK(static_cast<uint32_t>(MicroBitV2TypeAtomId::RadioPacket) == 1033);
  CHECK(static_cast<uint32_t>(MicroBitV2TypeAtomId::RadioPacketList) == 1034);
  CHECK(static_cast<uint32_t>(MicroBitV2TypeAtomId::SoundEmoji) == 1035);
  CHECK(static_cast<uint32_t>(MicroBitV2TypeAtomId::MicroBitAudio) == 1036);
  CHECK(static_cast<uint32_t>(MicroBitV2TypeAtomId::MicroBitThermometer) == 1037);
  CHECK(static_cast<uint32_t>(MicroBitV2TypeAtomId::PlaySoundOptions) == 1038);
  CHECK(static_cast<uint32_t>(MicroBitV2TypeAtomId::DrawImageOptions) == 1039);
  CHECK(static_cast<uint32_t>(MicroBitV2TypeAtomId::ScrollTextOptions) == 1040);
  CHECK(kMicroBitV2TypeAtomIdCount == 17);
  CHECK(static_cast<uint32_t>(MicroBitV2TypeAtomId::MicroBitDisplay) == TARGET_TYPE_ATOM_BASE);
}

TEST_CASE("SharedTypeAtomId values are wire-stable") {
  CHECK(static_cast<uint32_t>(mindcraft::SharedTypeAtomId::Image) == 2048);
  CHECK(mindcraft::kSharedTypeAtomIdCount == 1);
  CHECK(static_cast<uint32_t>(mindcraft::SharedTypeAtomId::Image) ==
        mindcraft::SHARED_TYPE_ATOM_BASE);
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
  CHECK(MicroBitV2HostActions::Gesture.actionId == 1030);
  CHECK(MicroBitV2HostActions::Gesture.fnId ==
        static_cast<uint32_t>(MicroBitV2HostFuncId::SensorGesture));
  CHECK(MicroBitV2HostActions::DrawImage.actionId == 1031);
  CHECK(MicroBitV2HostActions::DrawImage.fnId ==
        static_cast<uint32_t>(MicroBitV2HostFuncId::ActuatorDrawImage));
  CHECK(MicroBitV2HostActions::RadioSend.actionId == 1032);
  CHECK(MicroBitV2HostActions::RadioSend.fnId ==
        static_cast<uint32_t>(MicroBitV2HostFuncId::ActuatorRadioSend));
  CHECK(MicroBitV2HostActions::RadioReceiveNumber.actionId == 1033);
  CHECK(MicroBitV2HostActions::RadioReceiveNumber.fnId ==
        static_cast<uint32_t>(MicroBitV2HostFuncId::SensorRadioReceiveNumber));
  CHECK(MicroBitV2HostActions::RadioReceiveString.actionId == 1034);
  CHECK(MicroBitV2HostActions::RadioReceiveString.fnId ==
        static_cast<uint32_t>(MicroBitV2HostFuncId::SensorRadioReceiveString));
  CHECK(MicroBitV2HostActions::SetRadioGroup.actionId == 1035);
  CHECK(MicroBitV2HostActions::SetRadioGroup.fnId ==
        static_cast<uint32_t>(MicroBitV2HostFuncId::ActuatorSetRadioGroup));
  CHECK(MicroBitV2HostActions::RadioReceiveBuffer.actionId == 1036);
  CHECK(MicroBitV2HostActions::RadioReceiveBuffer.fnId ==
        static_cast<uint32_t>(MicroBitV2HostFuncId::SensorRadioReceiveBuffer));
  CHECK(MicroBitV2HostActions::PlaySound.actionId == 1037);
  CHECK(MicroBitV2HostActions::PlaySound.fnId ==
        static_cast<uint32_t>(MicroBitV2HostFuncId::ActuatorPlaySound));
  CHECK(MicroBitV2HostActions::DisplayClear.actionId == 1038);
  CHECK(MicroBitV2HostActions::DisplayClear.fnId ==
        static_cast<uint32_t>(MicroBitV2HostFuncId::ActuatorDisplayClear));
  CHECK(MicroBitV2HostActions::DisplayClear.fnId == 1076);
  CHECK(MicroBitV2HostActions::LightLevel.actionId == 1039);
  CHECK(MicroBitV2HostActions::LightLevel.fnId ==
        static_cast<uint32_t>(MicroBitV2HostFuncId::SensorLightLevel));
  CHECK(MicroBitV2HostActions::LightLevel.fnId == 1078);
  CHECK(MicroBitV2HostActions::Temperature.actionId == 1040);
  CHECK(MicroBitV2HostActions::Temperature.fnId ==
        static_cast<uint32_t>(MicroBitV2HostFuncId::SensorTemperature));
  CHECK(MicroBitV2HostActions::Temperature.fnId == 1080);

  REQUIRE(std::size(kMicroBitV2HostActions) == 17);
  for (uint32_t i = 0; i < std::size(kMicroBitV2HostActions); i++) {
    CHECK(kMicroBitV2HostActions[i].actionId == TARGET_ACTION_ID_BASE + i);
  }
}

TEST_CASE("MicroBitField values are wire-stable") {
  CHECK(static_cast<uint8_t>(MicroBitField::Display) == 0);
  CHECK(static_cast<uint8_t>(MicroBitField::ButtonA) == 1);
  CHECK(static_cast<uint8_t>(MicroBitField::ButtonB) == 2);
  CHECK(static_cast<uint8_t>(MicroBitField::Logo) == 3);
  CHECK(static_cast<uint8_t>(MicroBitField::Accelerometer) == 4);
  CHECK(static_cast<uint8_t>(MicroBitField::I2C) == 5);
  CHECK(static_cast<uint8_t>(MicroBitField::GPIO) == 6);
  CHECK(static_cast<uint8_t>(MicroBitField::Sonar) == 7);
  CHECK(static_cast<uint8_t>(MicroBitField::Radio) == 8);
  CHECK(static_cast<uint8_t>(MicroBitField::Audio) == 9);
  CHECK(static_cast<uint8_t>(MicroBitField::Thermometer) == 10);
  CHECK(kMicroBitFieldCount == 11);
}

TEST_CASE("the Context.microbit extension id sits just above the core Context fields") {
  CHECK(CONTEXT_MICROBIT_FIELD_ID == 6);
  CHECK(CONTEXT_MICROBIT_FIELD_ID == kContextFieldCount);
}
