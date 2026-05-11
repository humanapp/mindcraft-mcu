import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ContextTypeIds,
  coreModule,
  createMindcraftEnvironment,
  type ExecutionContext,
  extractNumberValue,
  isStructValue,
  List,
  type MindcraftEnvironment,
  mkNativeStructValue,
  mkNumberValue,
  NativeType,
  NIL_VALUE,
  type StructTypeDef,
} from "@mindcraft-lang/core/app";
import { MicroBit } from "../microbit-v2";
import { createMicroBitV2Module, WODAL_MICROBIT_V2_TYPE_IDS } from "./microbit-v2-module";

test("Context.microbit exposes the native WODAL microbit device", () => {
  const env = createMindcraftEnvironment({ modules: [coreModule(), createMicroBitV2Module()] });
  const microbit = new MicroBit();
  const ctx = createExecutionContext(env, microbit);
  const contextDef = getStructType(env, ContextTypeIds.Context);
  const microbitDef = getStructType(env, WODAL_MICROBIT_V2_TYPE_IDS.MicroBit);

  const microbitValue = contextDef.fieldGetter?.(mkNativeStructValue(ContextTypeIds.Context, ctx), "microbit", ctx);
  assert.ok(isStructValue(microbitValue));
  assert.equal(microbitValue.typeId, WODAL_MICROBIT_V2_TYPE_IDS.MicroBit);
  assert.equal(microbitValue.native, microbit);

  const displayValue = microbitDef.fieldGetter?.(microbitValue, "display", ctx);
  assert.ok(isStructValue(displayValue));
  assert.equal(displayValue.typeId, WODAL_MICROBIT_V2_TYPE_IDS.MicroBitDisplay);
  assert.equal(displayValue.native, microbit.display);
});

test("MicroBitDisplay host methods route through the native display receiver", () => {
  const env = createMindcraftEnvironment({ modules: [coreModule(), createMicroBitV2Module()] });
  const microbit = new MicroBit();
  const ctx = createExecutionContext(env, microbit);
  const receiver = mkNativeStructValue(WODAL_MICROBIT_V2_TYPE_IDS.MicroBitDisplay, microbit.display);

  getSyncFunction(env, "MicroBitDisplay.setPixelValue").exec(
    ctx,
    List.from([receiver, mkNumberValue(1), mkNumberValue(2), mkNumberValue(300)])
  );

  assert.equal(microbit.display.getPixelValue(1, 2), 255);

  const brightness = getSyncFunction(env, "MicroBitDisplay.getPixelValue").exec(
    ctx,
    List.from([receiver, mkNumberValue(1), mkNumberValue(2)])
  );
  assert.equal(extractNumberValue(brightness), 255);

  getSyncFunction(env, "MicroBitDisplay.clear").exec(ctx, List.from([receiver]));

  assert.equal(microbit.display.getPixelValue(1, 2), 0);
});

test("microbit display host state is scoped to each execution context", () => {
  const firstEnv = createMindcraftEnvironment({ modules: [coreModule(), createMicroBitV2Module()] });
  const secondEnv = createMindcraftEnvironment({ modules: [coreModule(), createMicroBitV2Module()] });
  const firstMicroBit = new MicroBit();
  const secondMicroBit = new MicroBit();
  const firstReceiver = mkNativeStructValue(WODAL_MICROBIT_V2_TYPE_IDS.MicroBitDisplay, firstMicroBit.display);
  const secondReceiver = mkNativeStructValue(WODAL_MICROBIT_V2_TYPE_IDS.MicroBitDisplay, secondMicroBit.display);

  getSyncFunction(firstEnv, "MicroBitDisplay.setPixelValue").exec(
    createExecutionContext(firstEnv, firstMicroBit),
    List.from([firstReceiver, mkNumberValue(0), mkNumberValue(0), mkNumberValue(31)])
  );
  getSyncFunction(secondEnv, "MicroBitDisplay.setPixelValue").exec(
    createExecutionContext(secondEnv, secondMicroBit),
    List.from([secondReceiver, mkNumberValue(0), mkNumberValue(0), mkNumberValue(127)])
  );

  assert.equal(firstMicroBit.display.getPixelValue(0, 0), 31);
  assert.equal(secondMicroBit.display.getPixelValue(0, 0), 127);
});

function createExecutionContext(env: MindcraftEnvironment, microbit: MicroBit): ExecutionContext {
  return {
    services: env.brainServices as unknown as ExecutionContext["services"],
    getVariableBySlot: () => NIL_VALUE,
    setVariableBySlot: () => {},
    data: { microbit },
    time: 0,
    dt: 0,
    currentTick: 0,
  };
}

function getStructType(env: MindcraftEnvironment, typeId: string): StructTypeDef {
  const typeDef = env.brainServices.runtime.types.get(typeId);
  assert.ok(typeDef);
  assert.equal(typeDef.coreType, NativeType.Struct);
  return typeDef as StructTypeDef;
}

function getSyncFunction(env: MindcraftEnvironment, name: string) {
  const entry = env.brainServices.runtime.functions.get(name);
  assert.ok(entry);
  assert.equal(entry.isAsync, false);
  return entry.fn;
}
