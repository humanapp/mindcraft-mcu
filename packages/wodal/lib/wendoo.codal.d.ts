declare module "wendoo" {
  interface WendooTypeMap {
    Image: Image;
    Button: Button;
    TouchButton: TouchButton;
    Accelerometer: Accelerometer;
    I2C: I2C;
    GPIO: GPIO;
    Sonar: Sonar;
    RadioPacket: RadioPacket;
    RadioPacketList: RadioPacketList;
    Radio: Radio;
  }

  export interface Image {
    width: number;
    height: number;
    pixels: Buffer;
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
    analogRead(pin: number): number;
  }
  export interface Sonar {
    readonly __brand: unique symbol;
    distance(trig: number, echo: number): number;
  }
  export interface RadioPacket {
    seq: number;
    type: number;
    value: number;
    name: string;
    text: string;
    buffer: Buffer;
    rssi: number;
    serial: number;
    time: number;
  }
  export type RadioPacketList = Array<RadioPacket>;
  export interface Radio {
    readonly __brand: unique symbol;
    sendNumber(value: number): void;
    sendString(text: string): void;
    sendValue(name: string, value: number): void;
    sendBuffer(buffer: Buffer): void;
    sendRawBuffer(buffer: Buffer): void;
    setGroup(group: number): void;
    setTransmitPower(power: number): void;
    setFrequencyBand(band: number): void;
    receive(since: number): Array<RadioPacket>;
    currentSeq(): number;
  }
}
