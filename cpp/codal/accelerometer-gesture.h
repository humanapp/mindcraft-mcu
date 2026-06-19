#pragma once

#include <cstdint>

namespace mindcraft {

/**
 * Accelerometer gesture codes, transcribed verbatim from CODAL's
 * `driver-models/Accelerometer.h` (`ACCELEROMETER_EVT_*`).
 * {@link AccelerometerInputPort::getGesture} returns one of these values. The
 * four impact codes are not in magnitude order: 2G follows 8G in the CODAL
 * numbering.
 */
enum class AccelerometerGesture : uint16_t {
  None = 0,
  TiltUp = 1,
  TiltDown = 2,
  TiltLeft = 3,
  TiltRight = 4,
  FaceUp = 5,
  FaceDown = 6,
  Freefall = 7,
  Impact3G = 8,
  Impact6G = 9,
  Impact8G = 10,
  Shake = 11,
  Impact2G = 12,
};

} // namespace mindcraft
