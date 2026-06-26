declare module "mindcraft" {
  interface MindcraftTypeMap {
    Image: Image;
    MicroBitDisplay: MicroBitDisplay;
    Button: Button;
    TouchButton: TouchButton;
    Accelerometer: Accelerometer;
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
  export interface MicroBit {
    readonly __brand: unique symbol;
    readonly display: MicroBitDisplay;
    readonly buttonA: Button;
    readonly buttonB: Button;
    readonly logo: TouchButton;
    readonly accelerometer: Accelerometer;
  }
  export interface Context {
    readonly microbit: MicroBit;
  }
}
