import { stream } from "@mindcraft-lang/core";
import {
  type AsyncHandle,
  BrainTileLiteralDef,
  ContextTypeIds,
  CoreTypeIds,
  createHostActuator,
  createHostSensor,
  type ExecutionContext,
  extractNumberValue,
  extractStringValue,
  List,
  type MindcraftModule,
  type MindcraftModuleApi,
  mkCallDef,
  mkClosedStructValue,
  mkListValue,
  mkNativeStructValue,
  mkNumberValue,
  mkStringValue,
  mkTypeId,
  NativeType,
  NIL_VALUE,
  type ReadonlyList,
  type StructValue,
  type Value,
  VOID_VALUE,
} from "@mindcraft-lang/core/app";
import { bufferByteAt, bufferLength, isBufferValue, mkBufferValue } from "@mindcraft-lang/core/runtime";
import { Accelerometer } from "../../../core/accelerometer";
import { Button } from "../../../core/button";
import { Gpio } from "../../../core/gpio";
import { I2CBus } from "../../../core/i2c-bus";
import { toNonNegativeInteger } from "../../../core/numeric";
import {
  RADIO_RAW_PACKET_TYPE,
  Radio,
  RadioPacketType,
  type RadioSendRecord,
  type ReceivedRadioPacket,
  radioNumberIsInteger,
} from "../../../core/radio";
import { SensorDriver } from "../../../core/sensor-driver";
import { TouchButton } from "../../../core/touch-button";
import { WODAL_SHARED_TYPE_IDS } from "../../../mindcraft/shared-type-ids";
import { MicroBit } from "../microbit";
import { MicroBitDisplay } from "../microbit-display";
import { buttonABSensor, buttonASensor, buttonBSensor, buttonLogoSensor } from "./actions/button-sensor";
import displayDrawActuator, { clipImage, DEFAULT_DURATION_MS, DEFAULT_IMAGE } from "./actions/display-draw";
import { brightnessToPort, pixelCoordToPort } from "./actions/display-pixel-conversion";
import displayScrollActuator from "./actions/display-scroll";
import displaySetPixelActuator from "./actions/display-set-pixel";
import { gestureSensor } from "./actions/gesture-sensor";
import { radioReceiveNumberSensor, radioReceiveStringSensor } from "./actions/radio-receive";
import radioSendActuator from "./actions/radio-send";
import setRadioGroupActuator from "./actions/set-radio-group";
import { BUILT_IN_IMAGES, builtInImageStructValue } from "./built-in-images";
import { getMicroBitContextDevice } from "./context";
import { MICROBIT_V2_MODIFIERS } from "./modifiers";
import { MICROBIT_V2_PARAMETERS } from "./parameters";
import { MicroBitV2HostFuncId, MicroBitV2TypeAtomId } from "./tile-ids";

/** Mindcraft module ID for the WODAL profile. */
export const WODAL_MICROBIT_V2_MODULE_ID = "mindcraft.microbit-v2";

/** Mindcraft type IDs registered by the WODAL profile. */
export const WODAL_MICROBIT_V2_TYPE_IDS = {
  /** Native-backed aggregate for the simulated device. */
  MicroBit: mkTypeId(NativeType.Struct, "MicroBit"),

  /** Native-backed display facade for the simulated device. */
  MicroBitDisplay: mkTypeId(NativeType.Struct, "MicroBitDisplay"),

  /** Native-backed button facade for the simulated device. */
  Button: mkTypeId(NativeType.Struct, "Button"),

  /** Native-backed touch button facade for the simulated device. */
  TouchButton: mkTypeId(NativeType.Struct, "TouchButton"),

  /** Native-backed accelerometer facade for the simulated device. */
  Accelerometer: mkTypeId(NativeType.Struct, "Accelerometer"),

  /** Native-backed I2C bus facade for the simulated device. */
  I2C: mkTypeId(NativeType.Struct, "I2C"),

  /** Native-backed GPIO pin facade for the simulated device. */
  GPIO: mkTypeId(NativeType.Struct, "GPIO"),

  /** Native-backed sonar facade for the simulated device's background sensor driver. */
  Sonar: mkTypeId(NativeType.Struct, "Sonar"),

  /** Native-backed radio facade for the simulated device. */
  Radio: mkTypeId(NativeType.Struct, "Radio"),

  /** Value struct describing one received radio packet (drain-all element). */
  RadioPacket: mkTypeId(NativeType.Struct, "RadioPacket"),

  /** List of {@link RadioPacket}, the drain-all receive result type. */
  RadioPacketList: mkTypeId(NativeType.List, "RadioPacketList"),
} as const;

/**
 * Field ids of the `RadioPacket` value struct, in declaration order. Each is the
 * field's storage slot in the closed struct value the drain-all receive builds.
 */
enum RadioPacketField {
  Type = 0,
  Value = 1,
  Name = 2,
  Text = 3,
  Buffer = 4,
  Rssi = 5,
  Serial = 6,
  Time = 7,
}

/**
 * Numeric field ids for the `MicroBit` struct. Each value is the field's durable
 * id and storage slot, and is the single source for both the registered
 * `fieldIndex` and the `fieldGetter` dispatch.
 */
export enum MicroBitField {
  Display = 0,
  ButtonA = 1,
  ButtonB = 2,
  Logo = 3,
  Accelerometer = 4,
  I2C = 5,
  GPIO = 6,
  Sonar = 7,
  Radio = 8,
}

/**
 * Field id of the `microbit` field this profile adds to the core `Context`
 * struct. Core owns Context ids 0-5; device extensions start at 6.
 */
export const CONTEXT_MICROBIT_FIELD_ID = 6;

/** Creates the Mindcraft module for the WODAL profile. */
export function createMicroBitV2Module(): MindcraftModule {
  return {
    id: WODAL_MICROBIT_V2_MODULE_ID,
    install(api: MindcraftModuleApi): void {
      registerMicroBitTypes(api);
      registerMicroBitDisplayFunctions(api);
      registerButtonFunctions(api);
      registerAccelerometerFunctions(api);
      registerI2CFunctions(api);
      registerGPIOFunctions(api);
      registerSonarFunctions(api);
      registerRadioFunctions(api);
      registerBrainTiles(api);
    },
  };
}

function registerMicroBitTypes(api: MindcraftModuleApi): void {
  const { types } = api.brainServices.runtime;

  types.addStructType("MicroBitDisplay", {
    atomId: MicroBitV2TypeAtomId.MicroBitDisplay,
    fields: List.empty(),
    fieldGetter: () => undefined,
    methods: List.from([
      {
        name: "setPixelValue",
        params: List.from([
          { name: "x", typeId: CoreTypeIds.Number },
          { name: "y", typeId: CoreTypeIds.Number },
          { name: "brightness", typeId: CoreTypeIds.Number },
        ]),
        returnTypeId: CoreTypeIds.Void,
      },
      {
        name: "getPixelValue",
        params: List.from([
          { name: "x", typeId: CoreTypeIds.Number },
          { name: "y", typeId: CoreTypeIds.Number },
        ]),
        returnTypeId: CoreTypeIds.Number,
      },
      {
        name: "clear",
        params: List.empty(),
        returnTypeId: CoreTypeIds.Void,
      },
      {
        name: "drawImage",
        params: List.from([
          { name: "image", typeId: WODAL_SHARED_TYPE_IDS.Image },
          { name: "duration", typeId: CoreTypeIds.Number, optional: true },
        ]),
        returnTypeId: CoreTypeIds.Void,
        isAsync: true,
      },
    ]),
  });

  types.addStructType("Button", {
    atomId: MicroBitV2TypeAtomId.Button,
    fields: List.empty(),
    fieldGetter: () => undefined,
    methods: List.from([
      {
        name: "isPressed",
        params: List.empty(),
        returnTypeId: CoreTypeIds.Number,
      },
    ]),
  });

  types.addStructType("TouchButton", {
    atomId: MicroBitV2TypeAtomId.TouchButton,
    fields: List.empty(),
    fieldGetter: () => undefined,
    methods: List.from([
      {
        name: "isPressed",
        params: List.empty(),
        returnTypeId: CoreTypeIds.Number,
      },
      {
        name: "getThreshold",
        params: List.empty(),
        returnTypeId: CoreTypeIds.Number,
      },
      {
        name: "setThreshold",
        params: List.from([{ name: "threshold", typeId: CoreTypeIds.Number }]),
        returnTypeId: CoreTypeIds.Void,
      },
      {
        name: "getValue",
        params: List.empty(),
        returnTypeId: CoreTypeIds.Number,
      },
      {
        name: "setValue",
        params: List.from([{ name: "value", typeId: CoreTypeIds.Number }]),
        returnTypeId: CoreTypeIds.Void,
      },
    ]),
  });

  types.addStructType("Accelerometer", {
    atomId: MicroBitV2TypeAtomId.Accelerometer,
    fields: List.empty(),
    fieldGetter: () => undefined,
    methods: List.from([
      { name: "getX", params: List.empty(), returnTypeId: CoreTypeIds.Number },
      { name: "getY", params: List.empty(), returnTypeId: CoreTypeIds.Number },
      { name: "getZ", params: List.empty(), returnTypeId: CoreTypeIds.Number },
      { name: "getPitchRadians", params: List.empty(), returnTypeId: CoreTypeIds.Number },
      { name: "getRollRadians", params: List.empty(), returnTypeId: CoreTypeIds.Number },
      { name: "getPitch", params: List.empty(), returnTypeId: CoreTypeIds.Number },
      { name: "getRoll", params: List.empty(), returnTypeId: CoreTypeIds.Number },
      { name: "getGesture", params: List.empty(), returnTypeId: CoreTypeIds.Number },
    ]),
  });

  types.addStructType("I2C", {
    atomId: MicroBitV2TypeAtomId.I2C,
    fields: List.empty(),
    fieldGetter: () => undefined,
    methods: List.from([
      {
        name: "writeBuffer",
        params: List.from([
          { name: "address", typeId: CoreTypeIds.Number },
          { name: "data", typeId: CoreTypeIds.Buffer },
        ]),
        returnTypeId: CoreTypeIds.Number,
      },
      {
        name: "readBuffer",
        params: List.from([
          { name: "address", typeId: CoreTypeIds.Number },
          { name: "length", typeId: CoreTypeIds.Number },
        ]),
        returnTypeId: CoreTypeIds.Buffer,
      },
    ]),
  });

  types.addStructType("GPIO", {
    atomId: MicroBitV2TypeAtomId.GPIO,
    fields: List.empty(),
    fieldGetter: () => undefined,
    methods: List.from([
      {
        name: "digitalRead",
        params: List.from([{ name: "pin", typeId: CoreTypeIds.Number }]),
        returnTypeId: CoreTypeIds.Number,
      },
      {
        name: "digitalWrite",
        params: List.from([
          { name: "pin", typeId: CoreTypeIds.Number },
          { name: "value", typeId: CoreTypeIds.Number },
        ]),
        returnTypeId: CoreTypeIds.Number,
      },
      {
        name: "setPull",
        params: List.from([
          { name: "pin", typeId: CoreTypeIds.Number },
          { name: "mode", typeId: CoreTypeIds.Number },
        ]),
        returnTypeId: CoreTypeIds.Number,
      },
      {
        name: "servoWrite",
        params: List.from([
          { name: "pin", typeId: CoreTypeIds.Number },
          { name: "angle", typeId: CoreTypeIds.Number },
        ]),
        returnTypeId: CoreTypeIds.Number,
      },
    ]),
  });

  types.addStructType("Sonar", {
    atomId: MicroBitV2TypeAtomId.Sonar,
    fields: List.empty(),
    fieldGetter: () => undefined,
    methods: List.from([
      {
        name: "distance",
        params: List.from([
          { name: "trig", typeId: CoreTypeIds.Number },
          { name: "echo", typeId: CoreTypeIds.Number },
        ]),
        returnTypeId: CoreTypeIds.Number,
      },
    ]),
  });

  types.addStructType("RadioPacket", {
    atomId: MicroBitV2TypeAtomId.RadioPacket,
    fields: List.from([
      { name: "type", typeId: CoreTypeIds.Number, fieldIndex: RadioPacketField.Type },
      { name: "value", typeId: CoreTypeIds.Number, fieldIndex: RadioPacketField.Value },
      { name: "name", typeId: CoreTypeIds.String, fieldIndex: RadioPacketField.Name },
      { name: "text", typeId: CoreTypeIds.String, fieldIndex: RadioPacketField.Text },
      { name: "buffer", typeId: CoreTypeIds.Buffer, fieldIndex: RadioPacketField.Buffer },
      { name: "rssi", typeId: CoreTypeIds.Number, fieldIndex: RadioPacketField.Rssi },
      { name: "serial", typeId: CoreTypeIds.Number, fieldIndex: RadioPacketField.Serial },
      { name: "time", typeId: CoreTypeIds.Number, fieldIndex: RadioPacketField.Time },
    ]),
  });

  types.addListType("RadioPacketList", {
    atomId: MicroBitV2TypeAtomId.RadioPacketList,
    elementTypeId: WODAL_MICROBIT_V2_TYPE_IDS.RadioPacket,
  });

  types.addStructType("Radio", {
    atomId: MicroBitV2TypeAtomId.Radio,
    fields: List.empty(),
    fieldGetter: () => undefined,
    methods: List.from([
      {
        name: "sendNumber",
        params: List.from([{ name: "value", typeId: CoreTypeIds.Number }]),
        returnTypeId: CoreTypeIds.Void,
      },
      {
        name: "sendString",
        params: List.from([{ name: "text", typeId: CoreTypeIds.String }]),
        returnTypeId: CoreTypeIds.Void,
      },
      {
        name: "sendValue",
        params: List.from([
          { name: "name", typeId: CoreTypeIds.String },
          { name: "value", typeId: CoreTypeIds.Number },
        ]),
        returnTypeId: CoreTypeIds.Void,
      },
      {
        name: "sendBuffer",
        params: List.from([{ name: "buffer", typeId: CoreTypeIds.Buffer }]),
        returnTypeId: CoreTypeIds.Void,
      },
      {
        name: "sendRawBuffer",
        params: List.from([{ name: "buffer", typeId: CoreTypeIds.Buffer }]),
        returnTypeId: CoreTypeIds.Void,
      },
      {
        name: "setGroup",
        params: List.from([{ name: "group", typeId: CoreTypeIds.Number }]),
        returnTypeId: CoreTypeIds.Void,
      },
      {
        name: "setTransmitPower",
        params: List.from([{ name: "power", typeId: CoreTypeIds.Number }]),
        returnTypeId: CoreTypeIds.Void,
      },
      {
        name: "setFrequencyBand",
        params: List.from([{ name: "band", typeId: CoreTypeIds.Number }]),
        returnTypeId: CoreTypeIds.Void,
      },
      {
        name: "receive",
        params: List.empty(),
        returnTypeId: WODAL_MICROBIT_V2_TYPE_IDS.RadioPacketList,
      },
    ]),
  });

  types.addStructType("MicroBit", {
    atomId: MicroBitV2TypeAtomId.MicroBit,
    fields: List.from([
      { name: "display", typeId: WODAL_MICROBIT_V2_TYPE_IDS.MicroBitDisplay, fieldIndex: MicroBitField.Display },
      { name: "buttonA", typeId: WODAL_MICROBIT_V2_TYPE_IDS.Button, fieldIndex: MicroBitField.ButtonA },
      { name: "buttonB", typeId: WODAL_MICROBIT_V2_TYPE_IDS.Button, fieldIndex: MicroBitField.ButtonB },
      { name: "logo", typeId: WODAL_MICROBIT_V2_TYPE_IDS.TouchButton, fieldIndex: MicroBitField.Logo },
      {
        name: "accelerometer",
        typeId: WODAL_MICROBIT_V2_TYPE_IDS.Accelerometer,
        fieldIndex: MicroBitField.Accelerometer,
      },
      { name: "i2c", typeId: WODAL_MICROBIT_V2_TYPE_IDS.I2C, fieldIndex: MicroBitField.I2C },
      { name: "gpio", typeId: WODAL_MICROBIT_V2_TYPE_IDS.GPIO, fieldIndex: MicroBitField.GPIO },
      { name: "sonar", typeId: WODAL_MICROBIT_V2_TYPE_IDS.Sonar, fieldIndex: MicroBitField.Sonar },
      { name: "radio", typeId: WODAL_MICROBIT_V2_TYPE_IDS.Radio, fieldIndex: MicroBitField.Radio },
    ]),
    fieldGetter: (source, fieldId) => {
      const microbit = getNativeMicroBit(source);
      if (!microbit) {
        return NIL_VALUE;
      }
      switch (fieldId) {
        case MicroBitField.Display:
          return mkNativeStructValue(WODAL_MICROBIT_V2_TYPE_IDS.MicroBitDisplay, microbit.display);
        case MicroBitField.ButtonA:
          return mkNativeStructValue(WODAL_MICROBIT_V2_TYPE_IDS.Button, microbit.buttonA);
        case MicroBitField.ButtonB:
          return mkNativeStructValue(WODAL_MICROBIT_V2_TYPE_IDS.Button, microbit.buttonB);
        case MicroBitField.Logo:
          return mkNativeStructValue(WODAL_MICROBIT_V2_TYPE_IDS.TouchButton, microbit.logo);
        case MicroBitField.Accelerometer:
          return mkNativeStructValue(WODAL_MICROBIT_V2_TYPE_IDS.Accelerometer, microbit.accelerometer);
        case MicroBitField.I2C:
          return mkNativeStructValue(WODAL_MICROBIT_V2_TYPE_IDS.I2C, microbit.i2c);
        case MicroBitField.GPIO:
          return mkNativeStructValue(WODAL_MICROBIT_V2_TYPE_IDS.GPIO, microbit.gpio);
        case MicroBitField.Sonar:
          return mkNativeStructValue(WODAL_MICROBIT_V2_TYPE_IDS.Sonar, microbit.sensorDriver);
        case MicroBitField.Radio:
          return mkNativeStructValue(WODAL_MICROBIT_V2_TYPE_IDS.Radio, microbit.radio);
        default:
          return undefined;
      }
    },
  });

  types.addStructFields(
    ContextTypeIds.Context,
    List.from([
      { name: "microbit", typeId: WODAL_MICROBIT_V2_TYPE_IDS.MicroBit, fieldIndex: CONTEXT_MICROBIT_FIELD_ID },
    ]),
    (_source, fieldId, ctx) => {
      if (fieldId !== CONTEXT_MICROBIT_FIELD_ID) {
        return undefined;
      }
      const microbit = getMicroBitContextDevice(ctx);
      return microbit ? mkNativeStructValue(WODAL_MICROBIT_V2_TYPE_IDS.MicroBit, microbit) : NIL_VALUE;
    }
  );
}

function registerMicroBitDisplayFunctions(api: MindcraftModuleApi): void {
  const emptyCallDef = mkCallDef({ type: "bag", items: [] });

  api.registerFunction({
    id: MicroBitV2HostFuncId.DisplaySetPixelValue,
    name: "MicroBitDisplay.setPixelValue",
    isAsync: false,
    fn: {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => {
        getDisplayReceiver(args)?.setPixelValue(
          pixelCoordToPort(numberArg(args, 1)),
          pixelCoordToPort(numberArg(args, 2)),
          brightnessToPort(numberArg(args, 3))
        );
        return VOID_VALUE;
      },
    },
    callDef: emptyCallDef,
  });

  api.registerFunction({
    id: MicroBitV2HostFuncId.DisplayGetPixelValue,
    name: "MicroBitDisplay.getPixelValue",
    isAsync: false,
    fn: {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => {
        const brightness = getDisplayReceiver(args)?.getPixelValue(numberArg(args, 1), numberArg(args, 2)) ?? 0;
        return mkNumberValue(brightness);
      },
    },
    callDef: emptyCallDef,
  });

  api.registerFunction({
    id: MicroBitV2HostFuncId.DisplayClear,
    name: "MicroBitDisplay.clear",
    isAsync: false,
    fn: {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => {
        getDisplayReceiver(args)?.clear();
        return VOID_VALUE;
      },
    },
    callDef: emptyCallDef,
  });

  api.registerFunction({
    id: MicroBitV2HostFuncId.DisplayDrawImage,
    name: "MicroBitDisplay.drawImage",
    isAsync: true,
    fn: {
      exec: (ctx: ExecutionContext, args: ReadonlyList<Value>, handle: AsyncHandle) => {
        const display = getDisplayReceiver(args);
        if (!display) {
          handle.resolve(VOID_VALUE);
          return;
        }
        const imageArg = args.get(1);
        const clipped = (imageArg !== undefined ? clipImage(imageArg) : undefined) ?? DEFAULT_IMAGE;
        const durationSeconds = extractNumberValue(args.get(2));
        // Convert the seconds argument to whole ms at f32 precision, matching the device.
        const durationMs =
          durationSeconds === undefined
            ? DEFAULT_DURATION_MS
            : toNonNegativeInteger(Math.fround(durationSeconds * 1000));
        // This host function draws a single image, leased as a one-frame sequence.
        display.drawImage([clipped], durationMs, ctx.time, () => handle.resolve(VOID_VALUE));
      },
    },
    callDef: emptyCallDef,
  });
}

function registerButtonFunctions(api: MindcraftModuleApi): void {
  const emptyCallDef = mkCallDef({ type: "bag", items: [] });

  const isPressedRegistrations: ReadonlyArray<{ typeName: string; id: MicroBitV2HostFuncId }> = [
    { typeName: "Button", id: MicroBitV2HostFuncId.ButtonIsPressed },
    { typeName: "TouchButton", id: MicroBitV2HostFuncId.TouchButtonIsPressed },
  ];
  for (const { typeName, id } of isPressedRegistrations) {
    api.registerFunction({
      id,
      name: `${typeName}.isPressed`,
      isAsync: false,
      fn: {
        exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) =>
          mkNumberValue(getButtonReceiver(args)?.isPressed() ?? 0),
      },
      callDef: emptyCallDef,
    });
  }

  api.registerFunction({
    id: MicroBitV2HostFuncId.TouchButtonGetThreshold,
    name: "TouchButton.getThreshold",
    isAsync: false,
    fn: {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) =>
        mkNumberValue(getTouchButtonReceiver(args)?.getThreshold() ?? 0),
    },
    callDef: emptyCallDef,
  });

  api.registerFunction({
    id: MicroBitV2HostFuncId.TouchButtonSetThreshold,
    name: "TouchButton.setThreshold",
    isAsync: false,
    fn: {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => {
        getTouchButtonReceiver(args)?.setThreshold(numberArg(args, 1));
        return VOID_VALUE;
      },
    },
    callDef: emptyCallDef,
  });

  api.registerFunction({
    id: MicroBitV2HostFuncId.TouchButtonGetValue,
    name: "TouchButton.getValue",
    isAsync: false,
    fn: {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) =>
        mkNumberValue(getTouchButtonReceiver(args)?.getValue() ?? 0),
    },
    callDef: emptyCallDef,
  });

  api.registerFunction({
    id: MicroBitV2HostFuncId.TouchButtonSetValue,
    name: "TouchButton.setValue",
    isAsync: false,
    fn: {
      exec: (ctx: ExecutionContext, args: ReadonlyList<Value>) => {
        getTouchButtonReceiver(args)?.setValue(numberArg(args, 1), ctx.time);
        return VOID_VALUE;
      },
    },
    callDef: emptyCallDef,
  });
}

function registerAccelerometerFunctions(api: MindcraftModuleApi): void {
  const emptyCallDef = mkCallDef({ type: "bag", items: [] });

  const reads: ReadonlyArray<{ name: string; id: MicroBitV2HostFuncId; read: (a: Accelerometer) => number }> = [
    { name: "getX", id: MicroBitV2HostFuncId.AccelerometerGetX, read: (a) => a.getX() },
    { name: "getY", id: MicroBitV2HostFuncId.AccelerometerGetY, read: (a) => a.getY() },
    { name: "getZ", id: MicroBitV2HostFuncId.AccelerometerGetZ, read: (a) => a.getZ() },
    {
      name: "getPitchRadians",
      id: MicroBitV2HostFuncId.AccelerometerGetPitchRadians,
      read: (a) => a.getPitchRadians(),
    },
    { name: "getRollRadians", id: MicroBitV2HostFuncId.AccelerometerGetRollRadians, read: (a) => a.getRollRadians() },
    { name: "getPitch", id: MicroBitV2HostFuncId.AccelerometerGetPitch, read: (a) => a.getPitch() },
    { name: "getRoll", id: MicroBitV2HostFuncId.AccelerometerGetRoll, read: (a) => a.getRoll() },
    { name: "getGesture", id: MicroBitV2HostFuncId.AccelerometerGetGesture, read: (a) => a.getGesture() },
  ];
  for (const { name, id, read } of reads) {
    api.registerFunction({
      id,
      name: `Accelerometer.${name}`,
      isAsync: false,
      fn: {
        exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => {
          const receiver = getAccelerometerReceiver(args);
          return mkNumberValue(receiver ? read(receiver) : 0);
        },
      },
      callDef: emptyCallDef,
    });
  }
}

function registerI2CFunctions(api: MindcraftModuleApi): void {
  const emptyCallDef = mkCallDef({ type: "bag", items: [] });

  api.registerFunction({
    id: MicroBitV2HostFuncId.I2CWriteBuffer,
    name: "I2C.writeBuffer",
    isAsync: false,
    fn: {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => {
        const bus = getI2CReceiver(args);
        const address = toNonNegativeInteger(numberArg(args, 1));
        const bytes = bufferArgBytes(args.get(2));
        return mkNumberValue(bus ? bus.write(address, bytes) : 0);
      },
    },
    callDef: emptyCallDef,
  });

  api.registerFunction({
    id: MicroBitV2HostFuncId.I2CReadBuffer,
    name: "I2C.readBuffer",
    isAsync: false,
    fn: {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => {
        const bus = getI2CReceiver(args);
        const address = toNonNegativeInteger(numberArg(args, 1));
        const length = toNonNegativeInteger(numberArg(args, 2));
        const bytes = bus ? bus.read(address, length) : new Uint8Array(0);
        return mkBufferValue(stream.byteArrayFromUint8Array(bytes));
      },
    },
    callDef: emptyCallDef,
  });
}

function registerGPIOFunctions(api: MindcraftModuleApi): void {
  const emptyCallDef = mkCallDef({ type: "bag", items: [] });

  api.registerFunction({
    id: MicroBitV2HostFuncId.GpioDigitalRead,
    name: "GPIO.digitalRead",
    isAsync: false,
    fn: {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => {
        const gpio = getGPIOReceiver(args);
        const pin = toNonNegativeInteger(numberArg(args, 1));
        return mkNumberValue(gpio ? gpio.digitalRead(pin) : 0);
      },
    },
    callDef: emptyCallDef,
  });

  api.registerFunction({
    id: MicroBitV2HostFuncId.GpioDigitalWrite,
    name: "GPIO.digitalWrite",
    isAsync: false,
    fn: {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => {
        const gpio = getGPIOReceiver(args);
        const pin = toNonNegativeInteger(numberArg(args, 1));
        const value = toNonNegativeInteger(numberArg(args, 2));
        return mkNumberValue(gpio ? gpio.digitalWrite(pin, value) : 0);
      },
    },
    callDef: emptyCallDef,
  });

  api.registerFunction({
    id: MicroBitV2HostFuncId.GpioSetPull,
    name: "GPIO.setPull",
    isAsync: false,
    fn: {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => {
        const gpio = getGPIOReceiver(args);
        const pin = toNonNegativeInteger(numberArg(args, 1));
        const mode = toNonNegativeInteger(numberArg(args, 2));
        return mkNumberValue(gpio ? gpio.setPull(pin, mode) : 0);
      },
    },
    callDef: emptyCallDef,
  });

  api.registerFunction({
    id: MicroBitV2HostFuncId.GpioServoWrite,
    name: "GPIO.servoWrite",
    isAsync: false,
    fn: {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => {
        const gpio = getGPIOReceiver(args);
        const pin = toNonNegativeInteger(numberArg(args, 1));
        const angle = toNonNegativeInteger(numberArg(args, 2));
        return mkNumberValue(gpio ? gpio.setServo(pin, angle) : 0);
      },
    },
    callDef: emptyCallDef,
  });
}

function registerSonarFunctions(api: MindcraftModuleApi): void {
  const emptyCallDef = mkCallDef({ type: "bag", items: [] });

  api.registerFunction({
    id: MicroBitV2HostFuncId.SonarDistance,
    name: "Sonar.distance",
    isAsync: false,
    fn: {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => {
        const driver = getSonarReceiver(args);
        const trig = toNonNegativeInteger(numberArg(args, 1));
        const echo = toNonNegativeInteger(numberArg(args, 2));
        return mkNumberValue(driver ? driver.sonarDistance(trig, echo) : 0);
      },
    },
    callDef: emptyCallDef,
  });
}

const EMPTY_BYTES = new Uint8Array(0);

function registerRadioFunctions(api: MindcraftModuleApi): void {
  const emptyCallDef = mkCallDef({ type: "bag", items: [] });

  const sendRecord = (args: ReadonlyList<Value>, record: RadioSendRecord): Value => {
    const radio = getRadioReceiver(args);
    if (radio) {
      radio.send(record);
    }
    return VOID_VALUE;
  };

  api.registerFunction({
    id: MicroBitV2HostFuncId.RadioSendNumber,
    name: "Radio.sendNumber",
    isAsync: false,
    fn: {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => {
        const radio = getRadioReceiver(args);
        const value = numberArg(args, 1);
        return sendRecord(args, {
          type: radioNumberIsInteger(value) ? RadioPacketType.Number : RadioPacketType.Double,
          group: radio ? radio.group : 0,
          value,
          name: "",
          text: "",
          bytes: EMPTY_BYTES,
        });
      },
    },
    callDef: emptyCallDef,
  });

  api.registerFunction({
    id: MicroBitV2HostFuncId.RadioSendString,
    name: "Radio.sendString",
    isAsync: false,
    fn: {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => {
        const radio = getRadioReceiver(args);
        return sendRecord(args, {
          type: RadioPacketType.String,
          group: radio ? radio.group : 0,
          value: 0,
          name: "",
          text: extractStringValue(args.get(1)) ?? "",
          bytes: EMPTY_BYTES,
        });
      },
    },
    callDef: emptyCallDef,
  });

  api.registerFunction({
    id: MicroBitV2HostFuncId.RadioSendValue,
    name: "Radio.sendValue",
    isAsync: false,
    fn: {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => {
        const radio = getRadioReceiver(args);
        const value = numberArg(args, 2);
        return sendRecord(args, {
          type: radioNumberIsInteger(value) ? RadioPacketType.Value : RadioPacketType.DoubleValue,
          group: radio ? radio.group : 0,
          value,
          name: extractStringValue(args.get(1)) ?? "",
          text: "",
          bytes: EMPTY_BYTES,
        });
      },
    },
    callDef: emptyCallDef,
  });

  api.registerFunction({
    id: MicroBitV2HostFuncId.RadioSendBuffer,
    name: "Radio.sendBuffer",
    isAsync: false,
    fn: {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => {
        const radio = getRadioReceiver(args);
        return sendRecord(args, {
          type: RadioPacketType.Buffer,
          group: radio ? radio.group : 0,
          value: 0,
          name: "",
          text: "",
          bytes: bufferArgBytes(args.get(1)),
        });
      },
    },
    callDef: emptyCallDef,
  });

  api.registerFunction({
    id: MicroBitV2HostFuncId.RadioSendRawBuffer,
    name: "Radio.sendRawBuffer",
    isAsync: false,
    fn: {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => {
        const radio = getRadioReceiver(args);
        return sendRecord(args, {
          type: RADIO_RAW_PACKET_TYPE,
          group: radio ? radio.group : 0,
          value: 0,
          name: "",
          text: "",
          bytes: bufferArgBytes(args.get(1)),
        });
      },
    },
    callDef: emptyCallDef,
  });

  const configFns: ReadonlyArray<{ id: MicroBitV2HostFuncId; name: string; apply: (radio: Radio, n: number) => void }> =
    [
      { id: MicroBitV2HostFuncId.RadioSetGroup, name: "Radio.setGroup", apply: (radio, n) => radio.setGroup(n) },
      {
        id: MicroBitV2HostFuncId.RadioSetTransmitPower,
        name: "Radio.setTransmitPower",
        apply: (radio, n) => radio.setTransmitPower(n),
      },
      {
        id: MicroBitV2HostFuncId.RadioSetFrequencyBand,
        name: "Radio.setFrequencyBand",
        apply: (radio, n) => radio.setFrequencyBand(n),
      },
    ];
  for (const { id, name, apply } of configFns) {
    api.registerFunction({
      id,
      name,
      isAsync: false,
      fn: {
        exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => {
          const radio = getRadioReceiver(args);
          if (radio) {
            apply(radio, numberArg(args, 1));
          }
          return VOID_VALUE;
        },
      },
      callDef: emptyCallDef,
    });
  }

  api.registerFunction({
    id: MicroBitV2HostFuncId.RadioReceive,
    name: "Radio.receive",
    isAsync: false,
    fn: {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) => {
        const radio = getRadioReceiver(args);
        if (!radio) {
          return mkListValue(WODAL_MICROBIT_V2_TYPE_IDS.RadioPacketList, List.empty());
        }
        return mkListValue(
          WODAL_MICROBIT_V2_TYPE_IDS.RadioPacketList,
          List.from(radio.drainAll().map(radioPacketStructValue))
        );
      },
    },
    callDef: emptyCallDef,
  });
}

/** Builds a `RadioPacket` value struct from a received packet, in field-index order. */
function radioPacketStructValue(packet: ReceivedRadioPacket): Value {
  return mkClosedStructValue(
    WODAL_MICROBIT_V2_TYPE_IDS.RadioPacket,
    List.from([
      mkNumberValue(packet.type),
      mkNumberValue(packet.value),
      mkStringValue(packet.name),
      mkStringValue(packet.text),
      mkBufferValue(stream.byteArrayFromUint8Array(packet.bytes)),
      mkNumberValue(packet.rssi),
      mkNumberValue(packet.serial),
      mkNumberValue(packet.time),
    ])
  );
}

function registerBrainTiles(api: MindcraftModuleApi): void {
  api.registerHostSensor(createHostSensor(buttonASensor));
  api.registerHostSensor(createHostSensor(buttonBSensor));
  api.registerHostSensor(createHostSensor(buttonABSensor));
  api.registerHostSensor(createHostSensor(buttonLogoSensor));
  api.registerHostSensor(createHostSensor(gestureSensor));
  api.registerHostSensor(createHostSensor(radioReceiveNumberSensor));
  api.registerHostSensor(createHostSensor(radioReceiveStringSensor));
  api.registerHostActuator(createHostActuator(radioSendActuator));
  api.registerHostActuator(createHostActuator(setRadioGroupActuator));
  api.registerHostActuator(createHostActuator(displaySetPixelActuator));
  api.registerHostActuator(createHostActuator(displayScrollActuator));
  api.registerHostActuator(createHostActuator(displayDrawActuator));
  api.registerModifiers(MICROBIT_V2_MODIFIERS);
  api.registerParameters(MICROBIT_V2_PARAMETERS);
  registerBuiltInImageTiles(api);
}

/**
 * Registers a surface-1 `Image` literal tile for each built-in icon. Each tile
 * carries the icon's baked `Image` struct value (see {@link builtInImageStructValue}):
 * placing it in a `draw image` image slot bakes that constant into the program.
 * The tiles are catalog-provided and referenced by id, so they do not persist
 * their struct value into a saved brain.
 */
function registerBuiltInImageTiles(api: MindcraftModuleApi): void {
  for (const def of BUILT_IN_IMAGES) {
    api.registerTile(
      new BrainTileLiteralDef(
        WODAL_SHARED_TYPE_IDS.Image,
        builtInImageStructValue(def),
        { valueLabel: def.name, persist: false, metadata: { label: def.label } },
        api.brainServices
      )
    );
  }
}

function getDisplayReceiver(args: ReadonlyList<Value>): MicroBitDisplay | undefined {
  const receiver = args.get(0);
  if (!isStructNative(receiver, WODAL_MICROBIT_V2_TYPE_IDS.MicroBitDisplay)) {
    return undefined;
  }
  return receiver.native instanceof MicroBitDisplay ? receiver.native : undefined;
}

function getButtonReceiver(args: ReadonlyList<Value>): Button | TouchButton | undefined {
  const receiver = args.get(0);
  if (
    !isStructNative(receiver, WODAL_MICROBIT_V2_TYPE_IDS.Button) &&
    !isStructNative(receiver, WODAL_MICROBIT_V2_TYPE_IDS.TouchButton)
  ) {
    return undefined;
  }
  return receiver.native instanceof Button ? receiver.native : undefined;
}

function getTouchButtonReceiver(args: ReadonlyList<Value>): TouchButton | undefined {
  const receiver = args.get(0);
  if (!isStructNative(receiver, WODAL_MICROBIT_V2_TYPE_IDS.TouchButton)) {
    return undefined;
  }
  return receiver.native instanceof TouchButton ? receiver.native : undefined;
}

function getAccelerometerReceiver(args: ReadonlyList<Value>): Accelerometer | undefined {
  const receiver = args.get(0);
  if (!isStructNative(receiver, WODAL_MICROBIT_V2_TYPE_IDS.Accelerometer)) {
    return undefined;
  }
  return receiver.native instanceof Accelerometer ? receiver.native : undefined;
}

function getI2CReceiver(args: ReadonlyList<Value>): I2CBus | undefined {
  const receiver = args.get(0);
  if (!isStructNative(receiver, WODAL_MICROBIT_V2_TYPE_IDS.I2C)) {
    return undefined;
  }
  return receiver.native instanceof I2CBus ? receiver.native : undefined;
}

function getGPIOReceiver(args: ReadonlyList<Value>): Gpio | undefined {
  const receiver = args.get(0);
  if (!isStructNative(receiver, WODAL_MICROBIT_V2_TYPE_IDS.GPIO)) {
    return undefined;
  }
  return receiver.native instanceof Gpio ? receiver.native : undefined;
}

function getSonarReceiver(args: ReadonlyList<Value>): SensorDriver | undefined {
  const receiver = args.get(0);
  if (!isStructNative(receiver, WODAL_MICROBIT_V2_TYPE_IDS.Sonar)) {
    return undefined;
  }
  return receiver.native instanceof SensorDriver ? receiver.native : undefined;
}

function getRadioReceiver(args: ReadonlyList<Value>): Radio | undefined {
  const receiver = args.get(0);
  if (!isStructNative(receiver, WODAL_MICROBIT_V2_TYPE_IDS.Radio)) {
    return undefined;
  }
  return receiver.native instanceof Radio ? receiver.native : undefined;
}

/** The bytes of a `Buffer` argument, in order; an empty array when the value is not a buffer. */
function bufferArgBytes(value: Value | undefined): Uint8Array {
  if (!isBufferValue(value)) {
    return new Uint8Array(0);
  }
  const length = bufferLength(value);
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    bytes[i] = bufferByteAt(value, i) ?? 0;
  }
  return bytes;
}

function getNativeMicroBit(value: StructValue): MicroBit | undefined {
  return value.native instanceof MicroBit ? value.native : undefined;
}

function isStructNative(value: Value | undefined, typeId: string): value is StructValue {
  return value !== undefined && value.t === NativeType.Struct && value.typeId === typeId;
}

function numberArg(args: ReadonlyList<Value>, index: number): number {
  return extractNumberValue(args.get(index)) ?? 0;
}
