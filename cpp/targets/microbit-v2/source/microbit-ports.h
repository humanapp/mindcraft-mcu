#pragma once

#include "MicroBit.h"

#include "codal/device-port.h"
#include "targets/microbit-v2/abi/button-index.h"
#include "targets/microbit-v2/abi/display-scroll.h"

namespace mindcraft
{

/**
 * micro:bit v2 implementations of the device ports. Each binds one abstract
 * port (cpp/codal/device-port.h) to a CODAL peripheral on the shared `MicroBit`
 * instance, which must outlive every port.
 */

/**
 * Drives the 5x5 LED matrix through `MicroBitDisplay`: direct pixel writes, the
 * asynchronous text scroll, and the asynchronous image draw. The scroll and the
 * timed draw share one display lease: a scroll starts CODAL's `scrollAsync` and a
 * timed draw pastes the frame, and either resolves its async handle once its
 * duration has elapsed, polled each host-loop tick by {@link pollDisplay}. A
 * scroll or draw requested while the lease is held is silently dropped (its
 * handle settles at once); a zero-duration draw pastes and settles at once
 * without taking the lease.
 */
class MicroBitPixelDisplayPort : public PixelDisplayPort
{
public:
    explicit MicroBitPixelDisplayPort(MicroBit &uBit) : uBit_(uBit) {}

    void setPixel(int16_t x, int16_t y, uint8_t brightness) override
    {
        uBit_.display.image.setPixelValue(x, y, brightness);
    }

    void scrollText(const uint8_t *bytes, uint32_t length, uint32_t delayMs, mc_number_t,
                    AsyncHandle handle) override
    {
        if (busy_)
        {
            handle.resolve(kVoidValue);
            return;
        }
        ManagedString text(reinterpret_cast<const char *>(bytes), static_cast<int16_t>(length));
        active_ = handle;
        busy_ = true;
        completionTime_ =
            static_cast<uint32_t>(system_timer_current_time()) + scrollDurationMs(length, delayMs);
        // The text scrolls in from a blank display; clear any prior content (an
        // earlier draw) first so it does not linger under the animation.
        uBit_.display.image.clear();
        uBit_.display.scrollAsync(text, static_cast<int>(delayMs));
    }

    void drawFrame(const uint8_t *frame, uint32_t width, uint32_t height, uint32_t durationMs,
                   mc_number_t, AsyncHandle handle) override
    {
        if (busy_)
        {
            handle.resolve(kVoidValue);
            return;
        }
        for (uint32_t row = 0; row < height; row++)
        {
            for (uint32_t col = 0; col < width; col++)
            {
                uBit_.display.image.setPixelValue(
                    static_cast<int16_t>(col), static_cast<int16_t>(row), frame[row * width + col]);
            }
        }
        if (durationMs > 0)
        {
            active_ = handle;
            busy_ = true;
            completionTime_ = static_cast<uint32_t>(system_timer_current_time()) + durationMs;
            return;
        }
        handle.resolve(kVoidValue);
    }

    /**
     * Settles the held scroll or timed draw's handle once its duration has
     * elapsed (enqueue-only; the think loop resumes the waiter). Call once per
     * host-loop tick before the brain thinks.
     */
    void pollDisplay()
    {
        if (!busy_ || static_cast<uint32_t>(system_timer_current_time()) < completionTime_)
        {
            return;
        }
        const AsyncHandle done = active_;
        busy_ = false;
        done.resolve(kVoidValue);
    }

    void preempt() override
    {
        if (!busy_)
        {
            return;
        }
        const AsyncHandle held = active_;
        busy_ = false;
        // Stop any in-flight CODAL scroll animation; the next operation repaints.
        uBit_.display.stopAnimation();
        held.resolve(kVoidValue);
    }

private:
    MicroBit &uBit_;
    bool busy_ = false;
    uint32_t completionTime_ = 0;
    AsyncHandle active_{};
};

/** Reads button levels: index 0 is button A, 1 is button B, 2 is the touch logo. */
class MicroBitButtonInputPort : public ButtonInputPort
{
public:
    explicit MicroBitButtonInputPort(MicroBit &uBit) : uBit_(uBit) {}

    bool isPressed(uint8_t buttonIndex) override
    {
        switch (static_cast<MicroBitButtonIndex>(buttonIndex))
        {
        case MicroBitButtonIndex::A:
            return uBit_.buttonA.isPressed() != 0;
        case MicroBitButtonIndex::B:
            return uBit_.buttonB.isPressed() != 0;
        case MicroBitButtonIndex::Logo:
            return uBit_.logo.isPressed() != 0;
        default:
            return false;
        }
    }

private:
    MicroBit &uBit_;
};

/**
 * Reads the accelerometer through `MicroBitAccelerometer`: the last recognized
 * gesture code plus the live acceleration (milli-g) and rotation-compensated
 * orientation (degrees). Each read returns CODAL's current value.
 */
class MicroBitAccelerometerInputPort : public AccelerometerInputPort
{
public:
    explicit MicroBitAccelerometerInputPort(MicroBit &uBit) : uBit_(uBit) {}

    uint16_t getGesture() override
    {
        // The value getters call requestUpdate() internally, but CODAL's getGesture()
        // does not; without a requestUpdate() the accelerometer never enables its idle
        // sampling, so gesture detection never runs and getGesture() stays NONE.
        uBit_.accelerometer.requestUpdate();
        return uBit_.accelerometer.getGesture();
    }

    int32_t getX() override { return uBit_.accelerometer.getX(); }

    int32_t getY() override { return uBit_.accelerometer.getY(); }

    int32_t getZ() override { return uBit_.accelerometer.getZ(); }

    int32_t getPitch() override { return uBit_.accelerometer.getPitch(); }

    int32_t getRoll() override { return uBit_.accelerometer.getRoll(); }

    mc_number_t getPitchRadians() override { return uBit_.accelerometer.getPitchRadians(); }

    mc_number_t getRollRadians() override { return uBit_.accelerometer.getRollRadians(); }

private:
    MicroBit &uBit_;
};

/** Monotonic millisecond clock backed by the CODAL system timer. */
class MicroBitMonotonicClockPort : public MonotonicClockPort
{
public:
    uint32_t uptimeMillis() override { return static_cast<uint32_t>(system_timer_current_time()); }
};

/**
 * Renders the device fault mode on the LED matrix: a sad face, then the
 * diagnostic code scrolled once. The code is also printed to serial once, the
 * first time it is shown.
 */
class MicroBitFaultDisplayPort : public FaultDisplayPort
{
public:
    explicit MicroBitFaultDisplayPort(MicroBit &uBit) : uBit_(uBit) {}

    void showFaultFace() override
    {
        uBit_.display.setBrightness(kFaultBrightness);
        uBit_.display.print(sadFace());
        uBit_.sleep(kFaultFaceHoldMs);
        uBit_.display.clear();
        uBit_.sleep(kFaultBlankMs);
    }

    void scrollFaultCode(const char *code) override
    {
        if (!serialReported_)
        {
            uBit_.serial.printf("mindcraft-mcu fault: code=%s\r\n", code);
            serialReported_ = true;
        }
        uBit_.display.scroll(ManagedString(code), kScrollDelayMs);
        uBit_.display.clear();
        uBit_.sleep(kFaultBlankMs);
    }

private:
    /** Display brightness for fault rendering (0-255). */
    static constexpr int kFaultBrightness = 170;

    /** Milliseconds the sad face holds before the screen clears. */
    static constexpr int kFaultFaceHoldMs = 600;

    /** Milliseconds the screen stays blank between fault frames. */
    static constexpr int kFaultBlankMs = 200;

    /** Milliseconds per scroll step; larger scrolls slower. */
    static constexpr int kScrollDelayMs = 200;

    /** A 5x5 sad face: two eyes over a downturned mouth. */
    static MicroBitImage sadFace()
    {
        MicroBitImage image(5, 5);
        image.setPixelValue(1, 0, 255);
        image.setPixelValue(3, 0, 255);
        image.setPixelValue(1, 3, 255);
        image.setPixelValue(2, 3, 255);
        image.setPixelValue(3, 3, 255);
        image.setPixelValue(0, 4, 255);
        image.setPixelValue(4, 4, 255);
        return image;
    }

    MicroBit &uBit_;
    bool serialReported_ = false;
};

} // namespace mindcraft
