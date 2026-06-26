import { CoreTypeIds, List, type MindcraftModule, type MindcraftModuleApi } from "@mindcraft-lang/core/app";
import { ImageField, WodalSharedTypeAtomId } from "./shared-type-ids";

/** Mindcraft module ID for the wodal-shared types installed by every target. */
export const WODAL_SHARED_MODULE_ID = "mindcraft.wodal-shared";

/**
 * Creates the wodal-shared Mindcraft module: nominal types common to every
 * wodal/codal target. Installed alongside the core module and a target module
 * so the shared types resolve regardless of the active target.
 */
export function createWodalSharedModule(): MindcraftModule {
  return {
    id: WODAL_SHARED_MODULE_ID,
    install(api: MindcraftModuleApi): void {
      registerSharedTypes(api);
    },
  };
}

function registerSharedTypes(api: MindcraftModuleApi): void {
  const { types } = api.brainServices.runtime;

  types.addStructType("Image", {
    atomId: WodalSharedTypeAtomId.Image,
    fields: List.from([
      { name: "width", typeId: CoreTypeIds.Number, fieldIndex: ImageField.Width },
      { name: "height", typeId: CoreTypeIds.Number, fieldIndex: ImageField.Height },
      { name: "pixels", typeId: CoreTypeIds.Buffer, fieldIndex: ImageField.Pixels },
    ]),
  });
}
