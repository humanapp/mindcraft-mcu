#pragma once

#include "codal/device-port.h"
#include "core/platform/span.h"
#include "core/runtime/execution-context.h"
#include "core/runtime/mc-number.h"
#include "core/runtime/value.h"

namespace mindcraft
{

/**
 * Light-level sensor body: polls the ambient light level off the display port and
 * returns it as a 0 (dark) to 255 (bright) number, which becomes the WHEN result
 * (truthy while above 0). A pure read with no per-callsite state. `hostData` is
 * the bound {@link DevicePorts}. Mirrors the wodal light-level-sensor oracle.
 */
inline Value execLightLevelSensor(void *hostData, ExecutionContext &ctx, Span<const Value> args)
{
    static_cast<void>(ctx);
    static_cast<void>(args);
    DevicePorts &ports = *static_cast<DevicePorts *>(hostData);
    return Value::number(static_cast<mc_number_t>(ports.display->getLightLevel()));
}

} // namespace mindcraft
