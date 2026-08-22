#pragma once

#include "codal/device-port.h"
#include "core/platform/span.h"
#include "core/runtime/execution-context.h"
#include "core/runtime/mc-number.h"
#include "core/runtime/value.h"

namespace wendoo
{

/**
 * Temperature sensor body: polls the die temperature off the thermometer port and
 * returns it as a signed whole-degree Celsius number, which becomes the WHEN
 * result (truthy while nonzero). A pure read with no per-callsite state.
 * `hostData` is the bound {@link DevicePorts}. Mirrors the wodal
 * temperature-sensor oracle.
 */
inline Value execTemperatureSensor(void *hostData, ExecutionContext &ctx, Span<const Value> args)
{
    static_cast<void>(ctx);
    static_cast<void>(args);
    DevicePorts &ports = *static_cast<DevicePorts *>(hostData);
    return Value::number(static_cast<mc_number_t>(ports.thermometer->getTemperature()));
}

} // namespace wendoo
