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
import { MicroBit, MicroBitDisplay } from "../microbit-v2";
import { getMicroBitContextDevice } from "./microbit-v2-context";

/** Mindcraft module ID for the WODAL microbit-v2 profile. */
export const WODAL_MICROBIT_V2_MODULE_ID = "mindcraft.microbit-v2";

/** Mindcraft type IDs registered by the WODAL microbit-v2 profile. */
export const WODAL_MICROBIT_V2_TYPE_IDS = {
  /** Native-backed aggregate for the simulated microbit device. */
  MicroBit: mkTypeId(NativeType.Struct, "MicroBit"),

  /** Native-backed display facade for the simulated microbit device. */
  MicroBitDisplay: mkTypeId(NativeType.Struct, "MicroBitDisplay"),
} as const;

/** Creates the Mindcraft module for the WODAL microbit-v2 profile. */
export function createMicroBitV2Module(): MindcraftModule {
  return {
    id: WODAL_MICROBIT_V2_MODULE_ID,
    install(api: MindcraftModuleApi): void {
      registerMicroBitTypes(api);
      registerMicroBitDisplayFunctions(api);
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

  types.addStructType("MicroBit", {
    fields: List.from([{ name: "display", typeId: WODAL_MICROBIT_V2_TYPE_IDS.MicroBitDisplay }]),
    fieldGetter: (source, fieldName) => {
      if (fieldName !== "display") {
        return undefined;
      }
      const microbit = getNativeMicroBit(source);
      return microbit ? mkNativeStructValue(WODAL_MICROBIT_V2_TYPE_IDS.MicroBitDisplay, microbit.display) : NIL_VALUE;
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

function getDisplayReceiver(args: ReadonlyList<Value>): MicroBitDisplay | undefined {
  const receiver = args.get(0);
  if (!isStructNative(receiver, WODAL_MICROBIT_V2_TYPE_IDS.MicroBitDisplay)) {
    return undefined;
  }
  return receiver.native instanceof MicroBitDisplay ? receiver.native : undefined;
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
