#pragma once

#include <cstdint>

#include "core/runtime/handle-table.h"
#include "core/runtime/mc-number.h"

namespace mindcraft {

/**
 * Supplies the frames of a timed image draw to a {@link PixelDisplayPort}. The
 * port reads every frame up front (into its own storage) when the draw is
 * accepted, so the source need only outlive the `drawFrames` call.
 */
class DrawFrameSource {
public:
  virtual ~DrawFrameSource() = default;

  /** Number of frames in the sequence; always at least one. */
  virtual uint32_t frameCount() = 0;

  /**
   * Write frame `index` (0-based, less than {@link frameCount}) as packed
   * brightness bytes, row-major, into `out`, and report its clipped
   * `width`/`height`. The frame is clipped to the board matrix, so
   * `width * height` bytes are written and `out` must have room for the board's
   * pixel count.
   */
  virtual void writeFrame(uint32_t index, uint8_t* out, uint32_t& width, uint32_t& height) = 0;
};

/**
 * Pixel-matrix display output. Coordinates are zero-based from the top-left;
 * dimensions are board-defined (5x5 on a micro:bit v2).
 */
class PixelDisplayPort {
public:
  virtual ~PixelDisplayPort() = default;

  /**
   * Set one pixel's brightness: 0 is off, 255 is full brightness. Coordinates
   * are signed (int16, the CODAL `Image::setPixelValue` parameter type); a write
   * whose coordinate falls outside the board's matrix is dropped by the device.
   */
  virtual void setPixel(int16_t x, int16_t y, uint8_t brightness) = 0;

  /**
   * Begin scrolling `length` ASCII bytes across the display at `delayMs` per
   * animation step, requested at logical tick time `requestTimeMs`. The call
   * returns immediately; the scroll runs asynchronously and settles `handle`
   * (resolve) when the animation completes. Scrolls serialize: one requested
   * while another is animating begins when the display next becomes free.
   */
  virtual void scrollText(const uint8_t* bytes, uint32_t length, uint32_t delayMs,
                          mc_number_t requestTimeMs, AsyncHandle handle) = 0;

  /**
   * Paste a sequence of packed brightness frames (row-major, one byte per pixel,
   * each already clipped to the board's matrix) to the display top-left, one
   * frame per `perFrameDurationMs` slice, requested at logical tick time
   * `requestTimeMs`. The port reads every frame from `frames` up front. The call
   * returns immediately and settles `handle` (resolve): a positive
   * `perFrameDurationMs` holds the display for `frameCount * perFrameDurationMs`,
   * advancing to the next frame each slice, before settling; a non-positive
   * `perFrameDurationMs` is fire-and-forget -- only the final frame is pasted, no
   * hold is taken, and `handle` settles at once. A draw requested while the
   * display is busy (a scroll or a held draw) is silently dropped: nothing is
   * pasted and `handle` settles at once. The last pasted frame is never cleared;
   * it persists until the next draw.
   */
  virtual void drawFrames(DrawFrameSource& frames, uint32_t perFrameDurationMs,
                          mc_number_t requestTimeMs, AsyncHandle handle) = 0;

  /**
   * Release the current display lease at once: a held scroll or timed draw is
   * dropped and its handle resolved, so its awaiting rule resumes as if the
   * operation finished. A no-op when no lease is held. The display content is
   * left as-is; the next operation overwrites it.
   */
  virtual void preempt() = 0;
};

/**
 * Momentary button input. Buttons are addressed by a zero-based index whose
 * mapping to physical inputs is board-defined (0 is button A, 1 is button B,
 * and 2 is the capacitive touch logo on a micro:bit v2).
 */
class ButtonInputPort {
public:
  virtual ~ButtonInputPort() = default;

  /** Current level of the button: true while physically pressed. */
  virtual bool isPressed(uint8_t buttonIndex) = 0;
};

/**
 * Three-axis accelerometer input. Exposes the last recognized gesture as a
 * board-defined gesture code plus the current acceleration (milli-g) and
 * rotation-compensated orientation (degrees or radians). All reads are polled
 * levels: the gesture holds its last value until a new one is recognized.
 */
class AccelerometerInputPort {
public:
  virtual ~AccelerometerInputPort() = default;

  /**
   * The last recognized gesture as a board-defined gesture code (0 when none
   * has been recognized). On a micro:bit v2 the codes are the CODAL
   * accelerometer gesture values.
   */
  virtual uint16_t getGesture() = 0;

  /** Acceleration along the X axis in milli-g; signed. */
  virtual int32_t getX() = 0;

  /** Acceleration along the Y axis in milli-g; signed. */
  virtual int32_t getY() = 0;

  /** Acceleration along the Z axis in milli-g; signed. */
  virtual int32_t getZ() = 0;

  /** Rotation-compensated pitch in whole degrees; signed. */
  virtual int32_t getPitch() = 0;

  /** Rotation-compensated roll in whole degrees; signed. */
  virtual int32_t getRoll() = 0;

  /** Rotation-compensated pitch in radians; signed. */
  virtual mc_number_t getPitchRadians() = 0;

  /** Rotation-compensated roll in radians; signed. */
  virtual mc_number_t getRollRadians() = 0;
};

/**
 * External I2C bus on the board's edge connector (pins P19/P20 on a micro:bit
 * v2). The controller side of the bus a peripheral library drives.
 */
class I2CPort {
public:
  virtual ~I2CPort() = default;

  /**
   * Write `len` bytes from `data` to the 7-bit `address` in one complete
   * START/STOP transaction. A zero `len` is an address-only transaction (`data`
   * may be null only then). Returns 0 on success, nonzero on a bus error.
   */
  virtual int write(uint16_t address, const uint8_t* data, int len) = 0;
};

/**
 * Board-side rendering primitives for the device fault mode. The fault-mode
 * policy (stop ticking the brain, then show-the-error in a loop) lives with
 * the host loop; implementations only render. Both calls may block for the
 * duration of their animation.
 */
class FaultDisplayPort {
public:
  virtual ~FaultDisplayPort() = default;

  /** Show the board's fault indicator (a sad face on a micro:bit v2). */
  virtual void showFaultFace() = 0;

  /** Scroll a short ASCII diagnostic code across the display, once. */
  virtual void scrollFaultCode(const char* code) = 0;
};

/** Monotonic time source used to stamp think-loop ticks. */
class MonotonicClockPort {
public:
  virtual ~MonotonicClockPort() = default;

  /** Milliseconds since an arbitrary fixed origin (boot). Never decreases. */
  virtual uint32_t uptimeMillis() = 0;
};

/**
 * The full set of board ports the host loop drives. Wired once by the target
 * at startup; every pointer is non-null and non-owning, and the pointed-to
 * ports must outlive the host loop.
 */
struct DevicePorts {
  PixelDisplayPort* display;
  ButtonInputPort* buttons;
  FaultDisplayPort* faultDisplay;
  MonotonicClockPort* clock;
  AccelerometerInputPort* accelerometer;
  I2CPort* i2c;
};

} // namespace mindcraft
