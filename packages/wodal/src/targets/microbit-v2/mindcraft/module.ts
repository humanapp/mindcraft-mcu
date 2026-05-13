import {
  ContextTypeIds,
  CoreTypeIds,
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
import type { MultiButton } from "../../../core/multi-button";
import { TouchButton } from "../../../core/touch-button";
import { MicroBit } from "../microbit";
import { MicroBitDisplay } from "../microbit-display";
import { getMicroBitContextDevice } from "./context";

/** Mindcraft module ID for the WODAL microbit-v2 profile. */
export const WODAL_MICROBIT_V2_MODULE_ID = "mindcraft.microbit-v2";

/** Mindcraft type IDs registered by the WODAL microbit-v2 profile. */
export const WODAL_MICROBIT_V2_TYPE_IDS = {
  /** Native-backed aggregate for the simulated microbit device. */
  MicroBit: mkTypeId(NativeType.Struct, "MicroBit"),

  /** Native-backed display facade for the simulated microbit device. */
  MicroBitDisplay: mkTypeId(NativeType.Struct, "MicroBitDisplay"),

  /** Native-backed button facade for the simulated microbit device. */
  Button: mkTypeId(NativeType.Struct, "Button"),

  /** Native-backed multi-button facade for the simulated microbit device. */
  MultiButton: mkTypeId(NativeType.Struct, "MultiButton"),

  /** Native-backed touch button facade for the simulated microbit device. */
  TouchButton: mkTypeId(NativeType.Struct, "TouchButton"),
} as const;

/** Creates the Mindcraft module for the WODAL microbit-v2 profile. */
export function createMicroBitV2Module(): MindcraftModule {
  return {
    id: WODAL_MICROBIT_V2_MODULE_ID,
    install(api: MindcraftModuleApi): void {
      registerMicroBitTypes(api);
      registerMicroBitDisplayFunctions(api);
      registerButtonFunctions(api);
    },
  };
}

function registerMicroBitTypes(api: MindcraftModuleApi): void {
  const { types } = api.brainServices.runtime;

  types.addStructType("MicroBitDisplay", {
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

  types.addStructType("MultiButton", {
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
    fields: List.from([
      { name: "display", typeId: WODAL_MICROBIT_V2_TYPE_IDS.MicroBitDisplay },
      { name: "buttonA", typeId: WODAL_MICROBIT_V2_TYPE_IDS.Button },
      { name: "buttonB", typeId: WODAL_MICROBIT_V2_TYPE_IDS.Button },
      { name: "buttonAB", typeId: WODAL_MICROBIT_V2_TYPE_IDS.MultiButton },
      { name: "logo", typeId: WODAL_MICROBIT_V2_TYPE_IDS.TouchButton },
    ]),
    fieldGetter: (source, fieldName) => {
      const microbit = getNativeMicroBit(source);
      if (!microbit) {
        return NIL_VALUE;
      }
      switch (fieldName) {
        case "display":
          return mkNativeStructValue(WODAL_MICROBIT_V2_TYPE_IDS.MicroBitDisplay, microbit.display);
        case "buttonA":
          return mkNativeStructValue(WODAL_MICROBIT_V2_TYPE_IDS.Button, microbit.buttonA);
        case "buttonB":
          return mkNativeStructValue(WODAL_MICROBIT_V2_TYPE_IDS.Button, microbit.buttonB);
        case "buttonAB":
          return mkNativeStructValue(WODAL_MICROBIT_V2_TYPE_IDS.MultiButton, microbit.buttonAB);
        case "logo":
          return mkNativeStructValue(WODAL_MICROBIT_V2_TYPE_IDS.TouchButton, microbit.logo);
        default:
          return undefined;
      }
    },
  });

  types.addStructFields(
    ContextTypeIds.Context,
    List.from([{ name: "microbit", typeId: WODAL_MICROBIT_V2_TYPE_IDS.MicroBit }]),
    (_source, fieldName, ctx) => {
      if (fieldName !== "microbit") {
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

  for (const typeName of ["Button", "MultiButton", "TouchButton"]) {
    api.registerFunction({
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
    name: "TouchButton.getThreshold",
    isAsync: false,
    fn: {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) =>
        mkNumberValue(getTouchButtonReceiver(args)?.getThreshold() ?? 0),
    },
    callDef: emptyCallDef,
  });

  api.registerFunction({
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
    name: "TouchButton.getValue",
    isAsync: false,
    fn: {
      exec: (_ctx: ExecutionContext, args: ReadonlyList<Value>) =>
        mkNumberValue(getTouchButtonReceiver(args)?.getValue() ?? 0),
    },
    callDef: emptyCallDef,
  });

  api.registerFunction({
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

function getDisplayReceiver(args: ReadonlyList<Value>): MicroBitDisplay | undefined {
  const receiver = args.get(0);
  if (!isStructNative(receiver, WODAL_MICROBIT_V2_TYPE_IDS.MicroBitDisplay)) {
    return undefined;
  }
  return receiver.native instanceof MicroBitDisplay ? receiver.native : undefined;
}

function getButtonReceiver(args: ReadonlyList<Value>): Button | MultiButton | TouchButton | undefined {
  const receiver = args.get(0);
  if (
    !isStructNative(receiver, WODAL_MICROBIT_V2_TYPE_IDS.Button) &&
    !isStructNative(receiver, WODAL_MICROBIT_V2_TYPE_IDS.MultiButton) &&
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
