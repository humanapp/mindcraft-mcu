#pragma once

#include <cstddef>
#include <cstdint>

#include "core/platform/span.h"

namespace mindcraft
{

// The reserved on-flash program region, placed by mcprogram-region.ld; the
// linker provides these as absolute flash addresses.
extern "C"
{
    extern uint8_t __mcprogram_region_start[];
    extern uint8_t __mcprogram_region_end[];
}

/**
 * A read-only view of the reserved on-flash program region. nRF flash is
 * memory-mapped, so the bytes are read in place.
 */
inline ByteSpan programFlashRegion()
{
    const size_t size = static_cast<size_t>(__mcprogram_region_end - __mcprogram_region_start);
    return ByteSpan(__mcprogram_region_start, size);
}

} // namespace mindcraft
