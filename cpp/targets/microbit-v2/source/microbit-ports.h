#pragma once

#include "MicroBit.h"

#include "codal/device-port.h"

namespace mindcraft
{

/**
 * micro:bit v2 implementations of the device ports. Each binds one abstract
 * port (cpp/codal/device-port.h) to a CODAL peripheral on the shared `MicroBit`
 * instance, which must outlive every port.
 */

/** Drives the 5x5 LED matrix through `MicroBitDisplay::image`. */
class MicroBitPixelDisplayPort : public PixelDisplayPort
{
  public:
    explicit MicroBitPixelDisplayPort(MicroBit &uBit) : uBit_(uBit) {}

    void setPixel(uint8_t x, uint8_t y, uint8_t brightness) override
    {
        uBit_.display.image.setPixelValue(static_cast<int16_t>(x), static_cast<int16_t>(y),
                                          brightness);
    }

  private:
    MicroBit &uBit_;
};

/** Reads debounced button levels: index 0 is button A, 1 is button B. */
class MicroBitButtonInputPort : public ButtonInputPort
{
  public:
    explicit MicroBitButtonInputPort(MicroBit &uBit) : uBit_(uBit) {}

    bool isPressed(uint8_t buttonIndex) override
    {
        switch (buttonIndex)
        {
        case 0:
            return uBit_.buttonA.isPressed() != 0;
        case 1:
            return uBit_.buttonB.isPressed() != 0;
        default:
            return false;
        }
    }

  private:
    MicroBit &uBit_;
};

/** Monotonic millisecond clock backed by the CODAL system timer. */
class MicroBitMonotonicClockPort : public MonotonicClockPort
{
  public:
    uint32_t uptimeMillis() override
    {
        return static_cast<uint32_t>(system_timer_current_time());
    }
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
