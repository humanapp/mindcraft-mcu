import { mkTypeId, NativeType } from "@mindcraft-lang/core/app";

/**
 * Stable type-atom ids of the wodal-shared nominal types: structs common to
 * every wodal/codal target, registered by the shared module each target
 * installs. Serialized programs reference nominal types by these values, so a
 * value, once assigned, is never changed or reused. All values are at or above
 * the shared tier base (2048), above every target's own atom range, so shared
 * atoms are identified independently of any target. Append new members at the
 * next free id.
 */
export enum WodalSharedTypeAtomId {
  Image = 2048,
}

/**
 * Numeric field ids and storage slots for the `Image` value struct. Each value
 * is the field's durable id and slot; baked `Image` literals store their fields
 * in this slot order.
 */
export enum ImageField {
  Width = 0,
  Height = 1,
  Pixels = 2,
}

/** Mindcraft type IDs registered by the wodal-shared module. */
export const WODAL_SHARED_TYPE_IDS = {
  /** Value struct holding an image: dimensions plus a packed pixel buffer. */
  Image: mkTypeId(NativeType.Struct, "Image"),
} as const;
