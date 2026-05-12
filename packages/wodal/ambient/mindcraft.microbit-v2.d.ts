declare module "mindcraft" {
  interface MindcraftTypeMap {
    MicroBitDisplay: MicroBitDisplay;
    Button: Button;
    MultiButton: MultiButton;
    TouchButton: TouchButton;
    MicroBit: MicroBit;
  }

  export interface MicroBitDisplay {
    readonly __brand: unique symbol;
    setPixelValue(x: number, y: number, brightness: number): void;
    getPixelValue(x: number, y: number): number;
    clear(): void;
  }
  export interface Button {
    readonly __brand: unique symbol;
    isPressed(): number;
  }
  export interface MultiButton {
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
  export interface MicroBit {
    readonly __brand: unique symbol;
    readonly display: MicroBitDisplay;
    readonly buttonA: Button;
    readonly buttonB: Button;
    readonly buttonAB: MultiButton;
    readonly logo: TouchButton;
  }
  export interface Context {
    readonly microbit: MicroBit;
  }
}
