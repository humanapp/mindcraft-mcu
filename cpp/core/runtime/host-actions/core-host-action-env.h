#pragma once

namespace mindcraft {

class BrainRuntime;
class GcRoots;
class ManagedHeap;
struct ProgramImage;
struct VmRng;

/**
 * Ambient capabilities the core sensor/actuator bodies reach for. Every core
 * host action is registered with a pointer to one of these as its `hostData`.
 * Each pointer is non-owning and must outlive every dispatch through the
 * bindings; the page-control bodies need {@link brain}, the random sensor needs
 * {@link rng}, the timeout sensor needs {@link heap}/{@link roots} to back its
 * per-callsite state, and the preceding-sibling sensor needs {@link program} to
 * read the loaded brain's rule structure.
 */
struct CoreHostActionEnv {
  /** Brain runtime the page-control sensors and actuators drive. */
  BrainRuntime* brain = nullptr;
  /** VM-global pseudo-random stream backing the random sensor. */
  VmRng* rng = nullptr;
  /** Managed heap backing the timeout sensor's per-callsite state list. */
  ManagedHeap* heap = nullptr;
  /** Collection root source for the timeout sensor's state allocation. */
  GcRoots* roots = nullptr;
  /** Loaded program image the preceding-sibling sensor derives rule order from. */
  const ProgramImage* program = nullptr;
};

} // namespace mindcraft
