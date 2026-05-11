declare module "mindcraft" {
  interface MindcraftTypeMap {
    MicroBitDisplay: MicroBitDisplay;
    MicroBit: MicroBit;
  }

  export interface MicroBitDisplay {
    readonly __brand: unique symbol;
    setPixelValue(x: number, y: number, brightness: number): void;
    getPixelValue(x: number, y: number): number;
    clear(): void;
  }
  export interface MicroBit {
    readonly __brand: unique symbol;
    readonly display: MicroBitDisplay;
  }
  export interface Context {
    readonly microbit: MicroBit;
  }
}
