declare module "mindcraft" {
  interface MindcraftTypeMap {
    Image: Image;
    MicroBitDisplay: MicroBitDisplay;
    Button: Button;
    TouchButton: TouchButton;
    Accelerometer: Accelerometer;
    I2C: I2C;
    GPIO: GPIO;
    Sonar: Sonar;
    MicroBit: MicroBit;
  }

  export interface Image {
    width: number;
    height: number;
    pixels: Buffer;
  }
  export interface MicroBitDisplay {
    readonly __brand: unique symbol;
    setPixelValue(x: number, y: number, brightness: number): void;
    getPixelValue(x: number, y: number): number;
    clear(): void;
    drawImage(image: Image, duration?: number): Promise<void>;
  }
  export interface Button {
    readonly __brand: unique symbol;
    isPressed(): number;
  }
  export interface TouchButton {
    readonly __brand: unique symbol;
    isPressed(): number;
    getThreshold(): number;
    setThreshold(threshold: number): void;
    getValue(): number;
    setValue(value: number): void;
  }
  export interface Accelerometer {
    readonly __brand: unique symbol;
    getX(): number;
    getY(): number;
    getZ(): number;
    getPitchRadians(): number;
    getRollRadians(): number;
    getPitch(): number;
    getRoll(): number;
    getGesture(): number;
  }
  export interface I2C {
    readonly __brand: unique symbol;
    writeBuffer(address: number, data: Buffer): number;
    readBuffer(address: number, length: number): Buffer;
  }
  export interface GPIO {
    readonly __brand: unique symbol;
    digitalRead(pin: number): number;
    digitalWrite(pin: number, value: number): number;
    setPull(pin: number, mode: number): number;
    servoWrite(pin: number, angle: number): number;
  }
  export interface Sonar {
    readonly __brand: unique symbol;
    distance(trig: number, echo: number): number;
  }
  export interface MicroBit {
    readonly __brand: unique symbol;
    readonly display: MicroBitDisplay;
    readonly buttonA: Button;
    readonly buttonB: Button;
    readonly logo: TouchButton;
    readonly accelerometer: Accelerometer;
    readonly i2c: I2C;
    readonly gpio: GPIO;
    readonly sonar: Sonar;
  }
  export interface Context {
    readonly microbit: MicroBit;
  }
}
