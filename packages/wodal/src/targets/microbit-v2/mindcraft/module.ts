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
  List,
  type MindcraftModule,
  type MindcraftModuleApi,
  mkCallDef,
  mkNativeStructValue,
  mkNumberValue,
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
import { I2CBus } from "../../../core/i2c-bus";
import { toNonNegativeInteger } from "../../../core/numeric";
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
} as const;

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

function registerBrainTiles(api: MindcraftModuleApi): void {
  api.registerHostSensor(createHostSensor(buttonASensor));
  api.registerHostSensor(createHostSensor(buttonBSensor));
  api.registerHostSensor(createHostSensor(buttonABSensor));
  api.registerHostSensor(createHostSensor(buttonLogoSensor));
  api.registerHostSensor(createHostSensor(gestureSensor));
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
