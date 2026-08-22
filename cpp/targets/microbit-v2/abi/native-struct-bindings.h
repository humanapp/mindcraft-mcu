#pragma once

#include <array>
#include <cstdint>

#include "core/platform/span.h"
#include "core/runtime/core-type-atom-id.h"
#include "core/runtime/type-registry.h"
#include "core/runtime/value.h"
#include "targets/microbit-v2/abi/microbit-field.h"
#include "targets/microbit-v2/abi/type-atom-id.h"

namespace wendoo
{

/**
 * Native struct values navigate the device object graph by identity alone: each
 * value is `Struct(typeId, discriminator)` with no managed slab. The
 * discriminator selects one instance among same-typed siblings; a singleton
 * (the context, the device, the display) uses {@link kNativeStructSingleton}.
 * The microbit getters set a button's discriminator to its producing
 * `MicroBitField` id, and the host-function bodies decode it back to the button
 * port index. All mutable state lives in the device ports, so these values
 * carry no heap reference. Mirrors mkNativeStructValue in
 * packages/wodal/src/targets/microbit-v2/wendoo/module.ts, where the live
 * device reference plays the discriminator's role.
 */
inline constexpr uint32_t kNativeStructSingleton = 0;

/**
 * Field getter of the device-extended `Context` struct. Resolves the `microbit`
 * field to the singleton `MicroBit` device struct; any other field reads nil
 * (the core context fields are not surfaced through this getter). Mirrors the
 * Context field getter installed by the microbit-v2 module.
 */
inline Value microBitContextFieldGetter(const Value & /*source*/, uint32_t fieldId)
{
    if (fieldId == CONTEXT_MICROBIT_FIELD_ID)
    {
        return Value::structValue(static_cast<uint32_t>(MicroBitV2TypeAtomId::MicroBit),
                                  kNativeStructSingleton);
    }
    return kNilValue;
}

/**
 * Field getter of the `MicroBit` device struct. Resolves `display` to the
 * singleton display struct, `buttonA`/`buttonB` to a `Button` struct and `logo`
 * to a `TouchButton` struct, each discriminated by its field id,
 * `accelerometer` to the singleton accelerometer struct, `i2c` to the singleton
 * I2C struct, `gpio` to the singleton GPIO struct, `sonar` to the singleton
 * sonar struct, `radio` to the singleton radio struct, `audio` to the singleton
 * audio struct, and `thermometer` to the singleton thermometer struct; any other
 * field reads nil. Mirrors the MicroBit field getter installed by the
 * microbit-v2 module.
 */
inline Value microBitFieldGetter(const Value & /*source*/, uint32_t fieldId)
{
    switch (static_cast<MicroBitField>(fieldId))
    {
    case MicroBitField::Display:
        return Value::structValue(static_cast<uint32_t>(MicroBitV2TypeAtomId::MicroBitDisplay),
                                  kNativeStructSingleton);
    case MicroBitField::ButtonA:
    case MicroBitField::ButtonB:
        return Value::structValue(static_cast<uint32_t>(MicroBitV2TypeAtomId::Button), fieldId);
    case MicroBitField::Logo:
        return Value::structValue(static_cast<uint32_t>(MicroBitV2TypeAtomId::TouchButton),
                                  fieldId);
    case MicroBitField::Accelerometer:
        return Value::structValue(static_cast<uint32_t>(MicroBitV2TypeAtomId::Accelerometer),
                                  kNativeStructSingleton);
    case MicroBitField::I2C:
        return Value::structValue(static_cast<uint32_t>(MicroBitV2TypeAtomId::I2C),
                                  kNativeStructSingleton);
    case MicroBitField::GPIO:
        return Value::structValue(static_cast<uint32_t>(MicroBitV2TypeAtomId::GPIO),
                                  kNativeStructSingleton);
    case MicroBitField::Sonar:
        return Value::structValue(static_cast<uint32_t>(MicroBitV2TypeAtomId::Sonar),
                                  kNativeStructSingleton);
    case MicroBitField::Radio:
        return Value::structValue(static_cast<uint32_t>(MicroBitV2TypeAtomId::Radio),
                                  kNativeStructSingleton);
    case MicroBitField::Audio:
        return Value::structValue(static_cast<uint32_t>(MicroBitV2TypeAtomId::MicroBitAudio),
                                  kNativeStructSingleton);
    case MicroBitField::Thermometer:
        return Value::structValue(static_cast<uint32_t>(MicroBitV2TypeAtomId::MicroBitThermometer),
                                  kNativeStructSingleton);
    default:
        return kNilValue;
    }
}

/** Number of microbit-v2 native struct field-accessor bindings. */
inline constexpr uint32_t kMicroBitV2NativeStructBindingCount = 2;

/**
 * Builds the microbit-v2 native struct field-accessor table, resolving the
 * context binding's key (the injected context value carries the `Context`
 * type's table index) against `registry`. The device structs key on their
 * stable type-atom ids, which the getters above stamp on the values they
 * produce. The returned array must outlive any registry it is installed into.
 */
inline std::array<NativeStructTypeBinding, kMicroBitV2NativeStructBindingCount>
makeMicroBitV2NativeStructBindings(const TypeRegistry &registry)
{
    const uint32_t contextTypeId =
        registry.findAtomType(static_cast<uint32_t>(CoreTypeAtomId::Context));
    return {{
        {contextTypeId, &microBitContextFieldGetter, nullptr},
        {static_cast<uint32_t>(MicroBitV2TypeAtomId::MicroBit), &microBitFieldGetter, nullptr},
    }};
}

} // namespace wendoo
