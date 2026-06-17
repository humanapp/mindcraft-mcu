import {
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
import { Button } from "../../../core/button";
import { TouchButton } from "../../../core/touch-button";
import { MicroBit } from "../microbit";
import { MicroBitDisplay } from "../microbit-display";
import buttonASensor from "./actions/button-a";
import displayScrollActuator from "./actions/display-scroll";
import displaySetPixelActuator from "./actions/display-set-pixel";
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

  types.addStructType("MicroBit", {
    atomId: MicroBitV2TypeAtomId.MicroBit,
    fields: List.from([
      { name: "display", typeId: WODAL_MICROBIT_V2_TYPE_IDS.MicroBitDisplay, fieldIndex: MicroBitField.Display },
      { name: "buttonA", typeId: WODAL_MICROBIT_V2_TYPE_IDS.Button, fieldIndex: MicroBitField.ButtonA },
      { name: "buttonB", typeId: WODAL_MICROBIT_V2_TYPE_IDS.Button, fieldIndex: MicroBitField.ButtonB },
      { name: "logo", typeId: WODAL_MICROBIT_V2_TYPE_IDS.TouchButton, fieldIndex: MicroBitField.Logo },
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
        getDisplayReceiver(args)?.setPixelValue(numberArg(args, 1), numberArg(args, 2), numberArg(args, 3));
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

function registerBrainTiles(api: MindcraftModuleApi): void {
  api.registerHostSensor(createHostSensor(buttonASensor));
  api.registerHostActuator(createHostActuator(displaySetPixelActuator));
  api.registerHostActuator(createHostActuator(displayScrollActuator));
  api.registerModifiers(MICROBIT_V2_MODIFIERS);
  api.registerParameters(MICROBIT_V2_PARAMETERS);
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

function getNativeMicroBit(value: StructValue): MicroBit | undefined {
  return value.native instanceof MicroBit ? value.native : undefined;
}

function isStructNative(value: Value | undefined, typeId: string): value is StructValue {
  return value !== undefined && value.t === NativeType.Struct && value.typeId === typeId;
}

function numberArg(args: ReadonlyList<Value>, index: number): number {
  return extractNumberValue(args.get(index)) ?? 0;
}
