import { CoreTypeIds, List, type WendooModule, type WendooModuleApi } from "@wendoo/core/app";
import { ImageField, WodalSharedTypeAtomId } from "./shared-type-ids";

/** Wendoo module ID for the wodal-shared types installed by every target. */
export const WODAL_SHARED_MODULE_ID = "wendoo.wodal-shared";

/**
 * Creates the wodal-shared Wendoo module: nominal types common to every
 * wodal/codal target. Installed alongside the core module and a target module
 * so the shared types resolve regardless of the active target.
 */
export function createWodalSharedModule(): WendooModule {
  return {
    id: WODAL_SHARED_MODULE_ID,
    install(api: WendooModuleApi): void {
      registerSharedTypes(api);
    },
  };
}

function registerSharedTypes(api: WendooModuleApi): void {
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
