#pragma once

namespace mindcraft {

/**
 * Brain numeric value type at the build profile's numeric precision. The
 * microbit-v2 profile is f32 (native on the M4F FPU); a build targeting a
 * different profile selects its precision by changing this typedef.
 */
using mc_number_t = float;

} // namespace mindcraft
