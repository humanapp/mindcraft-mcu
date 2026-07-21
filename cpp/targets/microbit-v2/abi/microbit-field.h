#pragma once

#include <cstdint>

namespace mindcraft
{

/**
 * Numeric field ids of the microbit-v2 `MicroBit` struct. Each value is the
 * field's durable id and its storage slot. Mirrors the MicroBitField enum in
 * packages/wodal/src/targets/microbit-v2/mindcraft/module.ts. Serialized
 * programs carry these ids in `STRUCT_GET_FIELD` / `STRUCT_SET_FIELD`
 * operands, so the values are wire-stable: never renumber or reuse a value;
 * append new members at the next free id.
 */
enum class MicroBitField : uint8_t
{
    Display = 0,
    ButtonA = 1,
    ButtonB = 2,
    Logo = 3,
    Accelerometer = 4,
    I2C = 5,
    GPIO = 6,
    Sonar = 7,
    Radio = 8,
    Audio = 9,
    Thermometer = 10,
};

/** Number of declared {@link MicroBitField} members; ids are dense from 0. */
inline constexpr uint32_t kMicroBitFieldCount = 11;

/**
 * Field id of the `microbit` field this profile adds to the core `Context`
 * struct. Core owns `Context` field ids 0-5; device extensions start at 6.
 * Mirrors CONTEXT_MICROBIT_FIELD_ID in
 * packages/wodal/src/targets/microbit-v2/mindcraft/module.ts.
 */
inline constexpr uint32_t CONTEXT_MICROBIT_FIELD_ID = 6;

} // namespace mindcraft
