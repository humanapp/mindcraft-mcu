declare module "mindcraft" {
  interface MindcraftTypeMap {
    MicroBitDisplay: MicroBitDisplay;
    SoundEmoji: SoundEmoji;
    MicroBit: MicroBit;
  }

  export interface MicroBitDisplay {
    readonly __brand: unique symbol;
    setPixelValue(x: number, y: number, brightness: number): void;
    getPixelValue(x: number, y: number): number;
    clear(): void;
    drawImage(image: Image, duration?: number): Promise<void>;
    scrollText(text: string): Promise<void>;
  }
  export interface SoundEmoji {
    name: string;
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
    readonly radio: Radio;
  }
  export interface Context {
    readonly microbit: MicroBit;
  }
}
