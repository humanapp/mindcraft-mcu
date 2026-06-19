# C++ VM On-Hardware Execution Engine - Phased Plan - 2026-06-05

## Purpose

This document plans the implementation of the C++ VM: the on-hardware execution
engine that runs a compiled Mindcraft brain (`.mcprogram`) on a real micro:bit v2
(nRF52833 / CODAL), mirroring the TypeScript reference VM's semantics exactly.

The C++ VM is the on-device counterpart to two TypeScript pieces:

- core's bytecode interpreter and brain runtime
  (`external/mindcraft-lang/packages/core/src/runtime/`: `vm.ts`,
  `brain-runtime.ts`), and
- WODAL's device runtime
  (`packages/wodal/src/targets/microbit-v2/mindcraft/runtime.ts`,
  `WodalMicroBitRuntime`).

It is greenfield: there is no C++ in the repo today. The central correctness bar
is parity - the C++ VM's opcode, value, scheduler, and host-calling semantics
must be provably identical to the TS reference VM, which is the executable spec.

This plan favors a clear final state over narrow local increments, and a vertical
slice (run the committed `button-display` brain end-to-end on hardware) before
full opcode conformance. Each phase leaves behind an API or behavior that belongs
in the final product shape.

This is a planning artifact. No implementation begins until the plan is reviewed
and accepted, and each phase's decisions are locked.

## Status

Last updated: 2026-06-17

**Memory model (read before touching any allocation):** the runtime is
**dynamic-first** - one `RegionArena` + one `Pool<T>`, everything allocated on
demand, **no pre-sized or max-sized buffers**, every `kMax*` an upper-bound
guard and never a pre-allocation size. This is **Locked Decision 7**; the
2026-06-13 course-correction Phase Log entry records how the earlier fixed-pool
design was superseded. Some accepted-phase notes below still describe the old
fixed-pool shapes (e.g. 3c's "fixed-array fiber records"); those are historical
and superseded by Locked Decision 7.

**No ABI compatibility machinery (read before touching deploy/ABI/flash):** there
is **no `abiVersion`, no `abiDigest`, no `firmwareId`**, and no version/digest/
identity field or check that gates whether a `.mcprogram` matches a firmware -
anywhere, ever. It was designed, then **removed**; this is **Locked Decision 8**, a
permanent prohibition with a review gate, **not** a deferral. ABI drift is caught
solely by the build-time field-by-field parity test. Reject on sight any proposal -
in any guise or new name - to add one back; the recurring "just a small
compatibility check, for safety" pull is exactly what LD8 exists to block.

**Minimum-mechanism (read before adding anything in any phase):** build only what
the phase **gate** exercises; speculative robustness - versioning, integrity
checks, identity/compatibility, future-proofing, pre-sizing, taxonomy inflation -
is out of scope **by default** and needs a concrete, possible-today failure mode
(not already caught elsewhere) to be included. This is **Locked Decision 9**, the
governing default that 7 and 8 are instances of; over-build has been the recurring
failure, and a subtraction pass precedes every gate. When unsure, leave it out.

Current focus: **Phase 7 (microbit-v2 device-surface completeness) - IN PROGRESS,
incremental peripheral-by-peripheral (adopted stance: poll sensors, await temporal
actuators). FIRST PERIPHERAL = BUTTONS: COMPLETE on both VMs + hardware-validated 2026-06-17.**
Surface 1 (tile language): 4 sensor tiles `[A]`/`[B]`/`[A+B]`/`[logo]`, 6 mutually-exclusive
modifiers (default `pressed`), poll-derived per-call-site state machine; the old button-A
sensor was overwritten (`[A]` reused its id 1024/1033). Surface 2 (TS user-code):
`ctx.microbit.buttonA/buttonB/logo.isPressed()` wired both VMs (no `buttonAB` - composable in
user code). Specs current: `docs/specs/tiles/button-sensor.md` (status implemented) +
`docs/specs/microbit-context.md`. The injectable sensor-input harness (scriptable down/up per
tick, both VMs) is now established + reusable. Stage-1 CODAL inventory done
(`generated-docs/codal-capability-inventory-2026-06-17.md`); tile-spec template at
`docs/specs/tiles/_template.md`; target-binding reorg done (commit `921a5b2`). **Next peripheral = accelerometer+gesture**
(chosen 2026-06-17): **specs RESOLVED both surfaces** (`docs/specs/tiles/accelerometer-sensor.md`
status proposed + the `microbit-context.md` accelerometer entry), implementation-ready. Design:
poll CODAL `getGesture()` (sync poll), inject the gesture enum for parity (CODAL owns
x/y/z->gesture, not reimplemented); the `gesture` tile is a level signal, default `shake`,
modifier set = shake + 4 tilt + 2 face + `freefall` + `impact` (impact unlocks conditional
`[2g/3g/6g/8g]` g-force-level sub-modifiers); surface 2 exposes `getGesture()` + the value
reads (x/y/z/pitch/roll), value reads surface-2-only. Sim UI = globe + spring-back g-force
slider, no dropdown, faithful wodal detector (interactive only; parity stays enum-injection).
**Implementation sub-phased A1-A5** (build plan:
`generated-docs/accelerometer-impl-plan-2026-06-18.md`): A1 port+harness foundation -> A2
surface-2 reads -> A3 gesture tile -> A4 impact+conditional -> A5 sim detector+globe; the
parity track (A2-A4) is separable from the sim-UX track (A5), and A1+A3 alone give a working
hardware-validated tile. **A1 COMPLETE (2026-06-18, host/firmware-build-gated): `AccelerometerInputPort`
(getGesture/getX-Y-Z/pitch-roll, radians-primary degrees-derived) + the CODAL gesture enum +
the test-only injectable harness; read-back parity fixture byte-matches both VMs.** **A2
COMPLETE (2026-06-18, host/firmware-build-gated; hardware read pending user flash): surface-2
`ctx.microbit.accelerometer.*` (8 sync host-fn reads, singleton struct no discriminator, ids
1039-1046, `MicroBitField.Accelerometer=4` appended last) + regenerated ambient `.d.ts`;
user-tile golden byte-matches both VMs. A2 found a cross-VM trace-parity bug on the user-tile
`setPixelValue` host-function path (see Deferred Work), worked around by integer-clean values.
Next: A3 (gesture tile).** Two further phases queued: 8 (virtual radio
sim-to-sim) and 9 (Cutebot via TS user-tiles).** **PHASE
6 IS COMPLETE
(6a-6j, 2026-06-17): the C++ VM is a fully conforming VM - every contract opcode
implemented, parity holding across the golden set.** Phases 6a (heap + containers), 6b
(structs + closures), 6c (core host-function library f32 + dynamic/managed strings), 6d
(pinned numerics), 6e (exceptions, yield, and the grow-on-demand stack arena), 6f1 (struct
re-string v3 + type-registry foundation), 6f2 (bytecode-action execution model), 6f3
(context-variable host functions 48-51), 6f4 (native device surface - user-tile milestone,
host-gated), 6f5 (core sensor/actuator host actions, hardware-validated), 6g (cap
parameterization - profile-sourced scheduler caps + parity guard), 6h (async core -
`HandleTable` + opcodes 41/45/50 + AWAIT/WAITING-resume + enqueue->drain, host-gated +
timer-brain hardware regression, 2026-06-16), 6i (display scroll-text - the first shipped
async capability, hardware-validated 2026-06-17), and 6j (conformance + parity suite - op 43
`ACTION_CALL_ASYNC` lands as the last opcode, both conformance gates + opcode coverage,
host-gated 2026-06-17) are accepted; the GC, containers, structs, closures, the ~96 core
`CoreFuncId` bodies, the RNG, managed strings, the 12 bit-exact pinned numeric components,
exceptions/yield, the grow-on-demand stack arena (the last LD7 worst-case reservation
removed), dynamic-key struct access (format v3), the type registry, the bytecode-action/page
execution model, brain+rule context variables, the native microbit device surface, the core
sensor/actuator host actions (timer/page-switch brains run on hardware), profile-sourced
scheduler caps, the async core (handles + await + out-of-loop settle), async
`display.scroll` (resolves on real hardware), and **every contract opcode (op 43 included)**
all run.
**The deploy arc is COMPLETE and hardware-proven** (2026-06-14):
5a firmware + 5b patcher + 5c browser delivery - a brain authored in microbit-sim
reaches a real micro:bit v2 by **download** (Blob -> drag-drop) or **WebUSB flash**
(paired device), and `button-display` toggles the pixel both ways. With Phases 1-5
done, what remains is VM conformance (Phase 6a-6j) and then the full microbit-v2
device surface (Phase 7); user-tile brains already patch + flash but run inert on
device until 6f's bytecode-action support.
Phase 5 is three sub-phases: **5a** (accepted 2026-06-13) is the
cpp firmware foundation - the on-flash region/header format + build->patcher
metadata schema, the linker region + boot read-path, the dual-artifact build -
which both deploy modes consume; **5b** is the wodal byte patcher (core + `wodal`
CLI), host/CI-gated, kept lean - a pure byte transform (small in-repo Intel HEX
writer); the ABI machinery / `firmwareId` / `.mcprogram` envelope are **permanently
removed** as over-build (Locked Decision 8 - a prohibition, never to return), and
the default-brain hex-splice is an optional post-acceptance add; **5c** is the
microbit-sim browser integration - **Blob download + WebUSB direct flashing** of a
patched hex, reusing 5b's core. (The previously-planned resident serial loader is
**deferred indefinitely** - the patcher + full-hex flashing suffice; see Deferred
Work.) 5b needs 5a; 5c needs 5b.
**5a as-built is LEANER than its original spec** (header = magic + formatVersion
only; ABI fields permanently removed, never to return - Locked Decision 8) - see
the 5a section + Phase Log.
Phases 1-5 are accepted -
**the slice runs on real hardware AND deploys to it end to end.** The VM decodes
(Phase 2) and behaves (Phase 3) byte-identically to the TS oracle on host, binds to
CODAL on device (Phase 4), and ships: a brain authored in `apps/microbit-sim`
reaches a real micro:bit v2 by **download** (Blob -> drag-drop) or **WebUSB flash**
(paired device), and `button-display` toggles the pixel both ways (Phase 5,
hardware-accepted 2026-06-14). The packaging architecture is user-locked: the
firmware is **built once by us** (prebuilt asset), and the wodal **byte patcher**
in `packages/wodal/src/mindcraft/` (driven from the `wodal` CLI and from
`apps/microbit-sim`) writes a brain into the firmware's flash region using the
offset 5a's build emits as metadata - end users never build C++. Phase 6 (a-h) now
brings full conformance (6a builds the `Pool<T>`/region heap; 6e removes the last
pre-sized buffer, `FiberWorkspace`; 6f lands bytecode actions so user-tile brains
run on device).

| Phase | Status | Notes |
| --- | --- | --- |
| Prep A: Binary `.mcprogram` Codec (TS) | **Complete (format v2)** | Shipped as `brain-program-binary-codec.ts`. Codec-local **flat** framing (magic + format-version + profileId + presence bitmask + positional, var-int-packed sections), **format version 2**: a `TYPS` type-table section between CSTR and CNUM; no typeId strings on the wire; enum constants as `(typeIdx, ordinal)`. Reader rejects any version != 2 (no legacy reader). Phase 2's C++ reader mirrors it byte-for-byte. |
| Prep B: Device ABI (statically assigned, source-declared ids) | **Complete (TS side)** | Every host-function/host-action registration carries a **required numeric id, statically declared in source**: funcIds as explicitly-valued enums (`CoreFuncId`, `MicroBitV2HostFuncId`, `SimFuncId`), host actions as per-module **record tables** (`CoreHostActions`, `MicroBitV2HostActions`, `SimHostActions`: one `{key, actionId, fnId}` record per action). **Type-id atoms landed with the typeId change**: required `atomId` on named core/target type registrations - `CoreTypeAtomId` (0-11) + `TARGET_TYPE_ATOM_BASE = 1024` in core `runtime/abi-ids.ts`, `MicroBitV2TypeAtomId` (1024-1027), `SimTypeAtomId`; `TypeRegistry.withOwner` + `resolveByAtomId`; dynamic/user types are atom-free (enforced). Counters removed; `withOwner` range validation; partition constants in core `runtime/abi-ids.ts`; fixtures embed the declared ids verbatim; `vm-contract.md` updated. Remaining: the C++ mirrors + parity tests land with Phases 3/4. **No manifest, no codegen.** |
| Prep C: The microbit-v2 TS Oracle (TS) | **Complete** | `ProfileNumerics` (`runtime/profile-numerics.ts`, injected via `AppServices.numerics`) with f32 result-rounding behind precision-agnostic ids; **round-based tick scheduling** (snapshot at tick entry; spawns, `YIELD`/budget re-enqueues, AND handle resumes join the next round; `maxFibersPerTick` deleted; `maxFibers` = loud spawn-time fault); `SchedulerConfig` carries `defaultBudget` (1000) + `hookBudget` (10000); microbit-v2 profile declares f32 + both budgets; `createMicroBitV2Environment()` is the single f32 wiring point; `vm-contract.md` gained numeric-semantics + fiber-scheduling sections. f32 transcendentals/formatter are **interim** (delegate-to-f64 + fround) until Phase 6d pins them. Fixtures did not move. |
| Phase 1a: Host Tree And C++ Foundations | **Accepted (2026-06-12)** | `cpp/` skeleton + desktop CMake + the `check.sh` suite; foundations encoded (C++17, exceptions/RTTI off in core, `-Wall -Wextra -Werror`, std policy, `.clang-format`); specimen mirror `error-code.h`; debug-ready (Debug preset, committed `.vscode/`, breakpoint manually verified) + ASan/UBSan variants; fixture-root plumbing wired. See Phase Log for the C++17-vs-codal-c++11 grounding. Phase 2 unblocked. |
| Phase 1b: Device Toolchain And First Boot | **Accepted (2026-06-12)** | Vendored `microbit-v2-samples` @ `04b7089d` with `codal-microbit-v2` pinned to v0.3.4 (libraries via its target-locked.json); Docker path pinned to gcc 10.3-2021.10 (sha256-verified, bit-identical rebuilds); serial boot heartbeat with `cpp/core/` compiled in at C++17 (the 1a obligation - proven on gcc 10.3 and 15.2); hardware boot verified. See Phase Log. |
| Phase 1c: Board-Agnostic Seam And Guardrails | **Accepted (2026-06-12)** | `cpp/codal/device-port.h` sketch (display/button/fault-display/clock ports + `DevicePorts`; revisable, pinned at Phase 4a) compiles + runs via a host stub test; `check-deps.sh` guardrail in the check suite (negative-tested). See Phase Log. |
| Phase 2a: Canonical Dump Contract (TS) | **Accepted (2026-06-12)** | Format v1 pinned (authoritative record: `brain-program-dump.ts` module JSDoc; hex-everything, profile-precision float bits, escaped-UTF-8 strings, TYPS indices/ordinals - nothing TS-only). Generator in core; five `<fixture>.mcprogram.dump` goldens committed via the write-if-missing specs; regen loop in `cpp/README.md`. Dump format version 1 is independent of binary format version 2. See Phase Log. |
| Phase 2b: Stream Primitives + ABI Mirrors (C++) | **Accepted (2026-06-12)** | `ByteCursor` (u8 / ULEB128 var-uint, 32-bit max / zigzag var-int / f32 via u32+memcpy / borrowed `readBytes`) with structured errors (`LoadError` diag enum + `Result<T, E>` generalization); decoded-image structures + bump arena (`program.h` / `program-arena.h`): **contiguous read-only image, index/run cross-references, `kNoFuncId`/`kNoTypeIdx` sentinels, strings borrowed from the wire buffer**. All mirror headers landed and value-pinned: core `core-func-id.h` (96 + partition constants), `core-type-atom-id.h` (12), `core-host-actions.h` (8 records), `context-field.h` (6), `bytecode.h` (`Op` 63 + `kOperandSchema` 63 rows); target mirrors under `cpp/targets/microbit-v2/abi/` (host-func-id 11, type-atom-id 4, host-actions 2, microbit-field 4 + `CONTEXT_MICROBIT_FIELD_ID = 6`). See Phase Log. Phase 2c fully unblocked. |
| Phase 2c: Reader + Dump Gate (C++) | **Accepted (2026-06-12)** | `core/codec/program-reader` (measure-then-fill decode into the arena image; f32-fixed by user decision) + `program-dump` (DumpSink, hand-rolled hex). **All five fixtures byte-match the 2a goldens on the first run**; exhaustive per-diagnostic negatives; `LoadError` 3-14 added. Strictness deviations + deferred depth cap user-ratified - see Phase Log. **PHASE 2 COMPLETE.** |
| Phase 3a: Observable-Trace Contract (TS, slim) | **Accepted (2026-06-12)** | Trace format v1 pinned (record: `observable-trace.ts` module JSDoc in wodal; `mctrace` header + tick/action/port/fault lines, dump rendering discipline). `PRESS_CYCLES_SCHEDULE` mirrored in-code; golden `button-display.press-cycles.trace` committed (generated from the binary fixture - stays on the parity path). Core untouched (harness taps the binding-table surface). See Phase Log; contract-bearing decisions carried into 3c. |
| Phase 3b: Value Model + Interpreter Core (C++) | **Accepted (2026-06-12)** | `Value` 12B POD + constexpr factories/tag-checked accessors (`mc-number.h` = the f32 typedef point); `ExecutionState` over three shared regions (operand/locals/frames - **locals separate from the operand stack** to preserve StackUnderflow-timing parity) behind the pinned fiber<->stack interface; `StackRegionPool` minimal allocator; budget-suspend/resume verified. Subset implemented incl. `LOAD/STORE_LOCAL` (scope call); `VAR_SLOT` ops + op 44 deferred to 3c; everything else faults `ScriptError` (full schema sweep under UBSan). New cap `kMaxLocalsSize` 256 ratified. 127 cases / 1653 assertions x3 presets. See Phase Log. |
| Phase 3c: Scheduler + Runtime Surface + Parity Gate (C++) | **Accepted (2026-06-12)** | Round-based `FiberScheduler` (fixed-array fiber records over the shared pools) + `BrainRuntime` think loop (dt rule, respawn, single-entry guard), `ExecutionContext` struct, binding table + `VmObserver`, op 44 + `VAR_SLOT` ops, trace-v1 emitter (shared `text-render.h`), action bodies as exact wodal ports in `targets/microbit-v2/abi/host-action-bindings.h` (Phase 4 re-binds them to CODAL). **Parity gate byte-matched the golden ON THE FIRST RUN.** Ratified seams in the Phase Log. **PHASE 3 COMPLETE.** |
| Phase 4a: Board-Agnostic Runtime Layer (host) | **Accepted (2026-06-13)** | `cpp/codal/` `HostLoop` (clock-port time source, single-entry) + fault-mode policy (`fault-mode.h`) + device sizing analysis (`device-sizing.h`); device-port interface pinned. Parity gate re-confirmed byte-identical through the real host loop; host-stub load-fault test green. **Landed alongside the dynamic-first memory-model rewrite** (Locked Decision 7 - see the 2026-06-13 course-correction Phase Log entry): `RegionArena` + `Pool<T>`, program-sized context slots, fiber-count caps removed then `maxFibers` re-added as a runaway guard. `check.sh` green x3; TS core + wodal suites green. |
| Phase 4b: micro:bit v2 Board Binding (hardware) | **Accepted (2026-06-13)** | CODAL port impls (`microbit-ports.h`) + firmware (`main.cpp`) running 4a's `HostLoop` on a **fixed sleep loop** (`tick()` + `uBit.sleep(16ms)`, sole think entry; real time sampled each tick so dt survives jitter). **Hardware-validated**: button A toggles pixel(0,0) matching the sim; corrupted-image hex shows sad face + scrolled code (L3/L8 reader rejects + E3 startup HostError latched). Flash ~31% of 364KB, within 128KB SRAM. **LD7/CODAL finding reconciled** (static `.bss` region, not a heap claim - see LD7 + Phase Log); `device-sizing.h` deleted (arbitrary constant + forbidden fibers x caps product). Embedded-array delivery is interim -> retired in 5a. |
| Phase 5a: Firmware Flash Foundation + Shared Contracts (cpp) | **Accepted (2026-06-13)** | Board-neutral on-flash region (`cpp/codal/on-flash-region.*`) + linker-defined region (`mcprogram-region.ld`; **dynamic placement** - start = page-aligned firmware flash end `ALIGN(__etext + SIZEOF(.data), 0x1000)`, end = `0x73000`, size = end - start; current build `0x39000` +~237 KiB; collision `ASSERT`) + boot read-path (`main.cpp`, decode-from-flash, zero-copy strings) + dual-artifact build (`MICROBIT.hex` + `MICROBIT.metadata.json` from ELF symbols). **As-built LEANER than planned** (two user simplification passes): header = magic `"MCFR"` + `formatVersion` only (checksum/length/ABI dropped); metadata = offset/size/magic/formatVersion only; `RegionError` 3 codes (`R1`/`R2`/`R3`). ALL ABI machinery (`abiVersion`/`abiDigest`/`firmwareId`) dropped - no grounded constants exist, and the 5b over-build audit then **removed it permanently** (Locked Decision 8 - a prohibition, never to return), not 5b. 4b embedded-program scaffolding **retired grep-clean**. **Host-gated**; on-device run lands in 5b. See Phase Log. |
| Phase 5b: Hex Patcher (wodal core + CLI) (TS, host/CI-gated) | **Accepted (2026-06-13)** | Target-neutral byte patcher + `wodal` CLI in `packages/wodal/src/mindcraft/` (`firmware-patcher.ts`, in-repo `intel-hex.ts` with type-04 ELA records, `wodalProgramBytes` for JSON-or-binary `.mcprogram`, `createWodalEnvironment`; esbuild-bundled self-contained Node bin). Pure byte transform: bounds-check fit (sole failure `program-too-large`), write 5-byte `MCFR` header + program at `regionOffset`, deterministic. ABI machinery / `firmwareId` / `.mcprogram` envelope **permanently removed** (Locked Decision 8). `firmware-metadata.ts` relocated to the neutral layer. Gate: 107/107 + ELA boundary verified; **hardware-validated** (CLI-built `button-display.hex` -> button A toggles), replacing 4b's embedded array. Optional post-acceptance: the **default-brain hex-splice**. See Phase Log. |
| Phase 5c: microbit-sim Deploy - Download + WebUSB Flash (TS/web) | **Accepted (2026-06-14)** | Per-brain links in `BrainList`: a **"download"** link (build patched hex -> Blob, always shown) and, after **Connect micro:bit** pairing, a per-brain **"flash"** link. WebUSB via **`@microbit/microbit-connection`** (wraps dapjs) with **partial flashing** (changed pages only, SoftDevice intact); flasher in microbit-sim, wodal core reused unchanged. Firmware asset vendored via `npm run vendor:firmware`. Chromium-only; download is the fallback. **Both gates hardware-validated**; download hex asserted byte-identical to the 5b CLI in CI. **The deploy arc (5a+5b+5c) is COMPLETE.** See Phase Log. |
| Phase 6a: Managed Heap + Value Containers | **Accepted (2026-06-14)** | Recursive mark-sweep GC + `SlabAllocator` (segregated free lists) + `ListObject`/`MapObject` in `managed-heap.*`; `LIST_*`/`MAP_*`/`TYPE_CHECK` wired; collect-on-alloc-fail at safe points, `FiberScheduler` is the `GcRoots` source; handles = arena byte-offsets. **As-built deviations (blessed): map hash index deferred** (ordered array + linear scan, LD9); **borrowed string-key equality by const-pool index** (managed-string keys need content compare in 6c). Gate: `container-ops` golden trace-parity + `managed-heap.test` (GC stress / cycles / aliasing) green x3 incl. UBSan. |
| Phase 6b: Structs + Closures | **Accepted (2026-06-14)** | Closed structs (`StructObject` slab from TYPS `slotCount`; `STRUCT_*` id-based + deep-copy + `STORE_VAR_SLOT`), `INSTANCE_OF` (TYPS-index compare), `CALL`/`CALL_INDIRECT*`/closures (`CapturesObject`); collector traces struct slots + captures. Name-keyed fallback shipped **option (a)** (degrades parity-correct - no field names in binary). Blessed: struct-sizing seam; deep-copy `PinNode` GC-safety (accepted, not deterministically testable). **Committed follow-up: re-string struct field names** (non-negotiable; leads Phase 6f1, 2026-06-15). Gate: `struct-closure` golden + managed-heap/vm tests; check.sh x3. |
| Phase 6c: Core Host-Function Library (f32) | **Accepted (2026-06-14)** | `HOST_CALL` dispatch (both ranges; core bodies only) + every non-pinned `CoreFuncId` in `core-host-functions.*`; **f32-native** (zero `double`/64-bit int - bit-identical to "f64 then fround" for `+ - * / % sqrt`, verified 120M pairs; exact `ToInt32`/`ToUint32`, Sterbenz `Math.round`); LCG RNG seed=`1` on `RuntimeSurface.rng`. **Managed strings**: immutable `Pool<StringObject>` + slab byte block (`kManagedStringRefBit`); `MapKey` content-compare unified across both string reps + traced. Pinned-deferred ids fault `ScriptError`. Value-vector gate in **wodal** (`core-host-fn-vectors`) - 628/628; check.sh x3 incl UBSan. Generalized 6b pin -> `Pin` RAII (collect-during-build now tested). Deferred: byte-only string builtins (ASCII-exact), `kNoTypeIdx` on container producers (->6f1), **context-variable host fns 48-51** (`ctx.brain`/`ctx.rule` `getVariable`/`setVariable`; carved out as "not core host-call bodies" -> fault, ->6f3). |
| Phase 6d: Pinned Numerics | **Accepted (2026-06-14)** | All 12 pinned f32 components in lockstep (TS + C++ + shared wodal vectors). 10 transcendentals ported from **Cephes single** (explicit binary32, zero `double`; `exp`/`log` loop-`frexp`/`ldexp`; `pow` = ECMAScript specials + integer binary-exp + `exp(y*log\|x\|)`). `formatNumber` = Ryu f2d (Apache/Boost) + `String(Number)` grammar, shortest-f32 (Luau-safe limb mulShift); `parseNumber` C++ = integer strtod (parseFloat grammar, no `double`). `-ffp-contract=off` per-source on `binary32-*.cpp` (FMA guard + test). Gate: `pinned-numerics-vectors` (2014 records) -> `pinned-numerics-parity.test.cpp` (6270 assertions), negative-control proven; check.sh x3 incl ASan+UBSan. No pinned id faults `ScriptError` anymore. |
| Phase 6e: Exceptions, Yield + Grow-On-Demand Stack Arena | **Accepted (2026-06-14)** | `TRY`/`END_TRY`/`THROW` + `YIELD` (C++ mirror of vm.ts). `FiberWorkspace` deleted -> `StackRegionAllocator` (dedicated `SlabAllocator`, list-backing realloc); four per-fiber regions grow 8/4/2/1 toward the caps; `ExecutionState` cap/capacity split; **last LD7 worst-case reservation removed**. Caps reconciled 256/256/64/16 (added TS `maxLocalsSize`, threaded the profile caps into `new VM` - root-caused the silent 4096/256/64 default). Dedicated stack slab means a grow never collects (faults only on arena exhaustion). Gate: exceptions-yield trace golden + `control-flow.test.cpp` + wodal `overflow-caps.spec.ts`; check.sh x3; core 911, wodal 116. 6f2 owes `assertCanSuspend`. |
| Phase 6f1: Struct Re-string (v3) + Type-Registry Foundation | **Accepted (2026-06-15)** | Format v2->v3: TYPS struct entry carries `fieldCount` + `(nameStringIdx, fieldId)` pairs -> `findStructField` resolves `GET_FIELD`/`SET_FIELD`/`STRUCT_COPY_EXCEPT` (dynamic-key `obj[expr]`/`{...x}` now works, no longer degrades; static stays id-based, LD2). New `TypeRegistry` over `ProgramImage` on `RuntimeSurface` (`STRUCT_GET/SET_FIELD` rewritten to `read/writeStructFieldById`; native branch present, unused until 6f4); closes 6c container-typeId carryover (`MapKeys`->`List<key>`, `MapValues`->`List<Any>`, `StrSplit`->`List<String>`). Field-name resolution lives in the program type table (not a host registry). Gate: `dynamic-field-access` golden + value-vectors 628/628 w/ structural typeIds; all fixtures regen v3; check.sh x3; core 911, wodal 117. |
| Phase 6f2: Bytecode-Action Execution Model | **Accepted (2026-06-15)** | `ACTION_CALL` (op 42) via extended `pushCallFrame` (actionBinding, isAsync=false); **new `callSiteSlots` pad** (flat `callSiteCount x callSiteSlotStride`, program-derived stride; distinct from the host-state cell) resolved by the per-fiber frame walk for `LOAD/STORE_CALLSITE_VAR`; `enumerateRoots` marks it. Page lifecycle: initializer (once) + activation (per-activation) in call-site order + deactivation on leave, with a page-change FSM in `think()` (deactivate old -> activate new before time-stamp); hooks via new `runActionHook`. `assertCanSuspend` (YIELD in sync action -> `ScriptError`). Gate: `action-page-lifecycle` + `sync-action-yield` goldens + 2 unit tests; check.sh x3; core 911, wodal 119. Deferred: `currentRuleFuncId` + rule inheritance (6f3); host `onInitialized`/`onPageExited` + injected-ctx entry (6f4); page restart = no-op. |
| Phase 6f3: Context-Variable Host Functions | **Accepted (2026-06-15)** | 48-51 via `vm.cpp` `HOST_CALL` -> `dispatchContextVariableFunc`. **Brain** slot-backed (`variableNames` scan -> `ctx.variables`); **rule** = `ExecutionContext.ruleVarStores` (outer `MapObject` keyed by `ruleFuncId` -> inner `MapObject`; both 6c maps, lazy, brain-lifetime), `ruleVarGet` walks `parentRuleFuncId` ancestors, `ruleVarSet` own-only; `enumerateRoots` marks it. `currentRuleFuncId` resolved on demand (`resolveFrameRuleFuncId`); wired the action-frame `ruleFuncId` inheritance (6f2 deferral). Gate: `context-variables` fixture (brain + rule + ancestor + action-frame inheritance) + 2 GC tests (closes 6f2's callSiteSlots marking); check.sh x3; wodal 120. (Flagged the CALL-frame rule-inheritance gap - forwarding `ctx` to a non-rule helper silently no-ops `ctx.rule`; **closed in 6f4** via `resolveCalleeRuleFuncId` on the CALL paths.) |
| Phase 6f4: Native Device Surface (user-tile milestone) | **Accepted (2026-06-15, host-gated; hardware hex pending user flash)** | CALL-frame rule inheritance (`resolveCalleeRuleFuncId` on CALL paths) + native-struct rep `Struct(typeId, disc-in-handle)` (mixed key: ctx = program-table index, device = type-atom-id; disc = `MicroBitField` id) + registry native getters (`native-struct-bindings.h`) + target host-fn surface (core `host-function.h` + `RuntimeSurface.hostFunctions`; `isPressed`/`setPixelValue` over `DevicePorts`) + `ctx` injection at root+`ACTION_CALL` (`pushCallFrame` `injectCtx` flag) + dual-path setPixel trace parity. `user-tile-button-display` byte-matches golden, ends pixel (0,0)=255; C++ 234 x3, wodal 122. Hex built (region 0x44000). |
| Phase 6f5: Core Sensor/Actuator Host Actions | **Accepted (2026-06-16, hardware-validated)** | All 8 core host actions (ids 0-7) ported as **core, target-agnostic** bodies (`cpp/core/runtime/host-actions/`; `makeCoreHostActionBindings`); firmware table = core 8 + microbit 2. Fixed the real on-device fault (op-44 core ids -> null -> ScriptError). BrainRuntime gained `requestPageRestart`/`requestPageChangeByPageId`/`get{Current,Previous}PageId`; `requestPageChange` mirrors TS (same-page = restart, real change cancels fibers). Timeout = per-callsite managed `List[fireTime,lastTick]` (GC-rooted). **Plus a general scheduler-interrupt fix** (`ExecutionState.cancelled` checked at each instruction boundary; mirrors TS mid-run state check) - touches the VM dispatch hot path, first exercised by in-rule page changes. Gate: 3 fixtures (timer/core-actions/restart-interrupt) byte-matched + unit tests; check.sh x3; wodal 125; **hardware-validated** (timer brain). |
| Phase 6g: Cap Parameterization (topology parity with TS) | **Accepted (2026-06-16)** | New core `DeviceProfileCaps` (8 fields); `FiberScheduler` ctor takes it (`spawn`/`runActionHook`/`tick` read `caps_`). Host supplies `kMicroBitV2DeviceProfileCaps` (`targets/.../device-profile.h`); global `constexpr` caps deleted; ~40 ctor sites threaded via a test helper. `profileId` validated in the host (`main.cpp`, faithful to TS) -> new core `LoadError::UnsupportedDeviceProfile`=15 on mismatch. Cap-parity guard: wodal `device-profile-caps-vectors` fixture -> C++ `device-profile-caps-parity.test.cpp` asserts each cap == the host caps (replaces literal asserts; 7 caps, `maxHandles` joins in 6i); negative-control proven. Pure refactor: 237 C++ cases, goldens byte-match; wodal 126. |
| Phase 6h: Async core | **Accepted (2026-06-16, host-gated + timer-brain hardware regression)** | Core `HandleTable` (`{id,state,result,error,waiters,nextCompleted}`, Pool-backed/LD7, new GC root via `enumerateResults`); opcodes 41 `HOST_CALL_ASYNC` / 45 `HOST_ACTION_CALL_ASYNC` / 50 `AWAIT` mirror vm.ts; **43 `ACTION_CALL_ASYNC` left to 6j** (still faults via `default:`; not a host-action async like 6i scroll - it needs a child-fiber spawn from inside dispatch, and no shipping fixture exercised it yet; 6j implements it - no opcode stays deferred). `AWAIT` parks `WAITING` (flips 3c's Waiting->HostError): resolved->push, rejected/cancelled->throw via the 6e handler path (shared `throwError` + `pendingInjectedThrow`); `assertCanSuspend` still faults await in a sync action frame. **Settle = enqueue; `drainCompletedHandles()` (in `think()`, after tick before sweep) resumes waiters next round** - accepts a settle made from outside the single-entry loop (the path 6i's CODAL listener needs). **Fixed the 6f2 fiber-id divergence** (C++ hook fibers now a descending inline id space, mirrors TS negatives). Gate: `async-handles.test.cpp` (9 cases, test caps `maxHandles=16`; microbit-v2 stays 0); 247 C++ cases x3, wodal 126. Blessed deviation: async bodies get the ephemeral stack view, not an owned snapshot (no consumer retains). (The open cross-VM async-goldens item was closed at 6i - the real `BrainRuntime` drives the golden.) |
| Phase 6i: Display Scroll-Text (first async capability) | **Accepted (2026-06-17, hardware-validated)** | Async `display.scroll(text)` action (`DisplayScroll` id 1026, fnId 1035, op 45; optional String arg default `"hello"`). Completion-time formula `start + 6*(charCount+1)*delay` pinned in the target layer (wodal `display-scroll.ts` + C++ `display-scroll.h`). **Core async reshape** (`external/mindcraft-lang`): bound resolver `AsyncHandle{resolve/reject/cancel}` passed as the 3rd async-body arg both VMs (host-binding API only, no bytecode change). `maxHandles` 0->8 (6g seam, 8th cap in the parity guard). Additive target trace lines (`...async` + `port display scroll`), format v1 unchanged. CODAL `pendolino3` font ported to wodal sim only (device renders natively). **Deviations from the original design:** device resolution = **formula poll**, not the `ANIMATION_COMPLETE` bus event (listener didn't fire on hardware); concurrent scrolls **reject**, not serialize (LD9 removed the fixed queue); the real `BrainRuntime` generates the golden, so **6h's cross-VM-oracle item is closed** (no separate harness). Gate: wodal 139, C++ 252 cases x3 (scroll golden byte-matches), core 913, hardware-validated. Open: managed-string scroll test (impl-complete). |
| Phase 6j: Conformance + Parity Suite | **Accepted (2026-06-17, host-gated; PHASE 6 COMPLETE)** | The C++ VM is now a **fully conforming VM** - every contract opcode implemented, zero `default:`-fault paths. **op 43 `ACTION_CALL_ASYNC`** landed (last opcode; new core `AsyncActionSpawner` on `RuntimeSurface`, impl by `FiberScheduler`; bytecode branch only; `tick()` settles the child result handle). Both conformance gates: **opcode-completeness manifest** + the **two-surface carve-out gate** (CoreFuncId classification + host-action binding coverage). **Opcode-coverage measurement** over the golden corpus + a new `opcode-coverage` brain for the 11 uncovered ops. New goldens: `async-action`, `opcode-coverage`, `pixel-conversion`, `managed-string-scroll`. **Port-seam resolution REVISED to match CODAL exactly** (int16 coords + device matrix early-out, u8 brightness no-clamp wrap - supersedes the recorded u8 option B; pinned in new `docs/specs/contracts/observable-trace.md`). Host-only emitters relocated to `cpp/hostkit`. Gate: 263 C++ cases x3, wodal 143, core 913. **Deferred** (not in gate): input-script file format (one consumer), instruction-trace mode (touches reference VM + dispatch hot path). |
| Phase 7: microbit-v2 Device-Surface Completeness | Placeholder - refine after Phase 6 | The **full** onboard sensor/actuator surface on both TS + C++ (accelerometer/gesture/temperature/magnetometer/compass/GPIO/... - today only display+buttons+touch exist). Front-loaded by a two-stage process the user owns: (1) CODAL capability inventory, (2) tile-language design deciding how to surface it (the `Context` surface is the **design output**, not predetermined). Then downstream build reuses 6f4's mechanism (append ABI ids, `Struct(typeId,disc)` rep, both-side impl, per-peripheral fixtures). Key new harness: deterministic injectable sensor inputs for parity. **Prerequisite DONE (2026-06-17, commit `921a5b2`): the monolithic cpp target binding files were split into per-concern files** under `abi/host-actions/{actuators,sensors}/` + `abi/host-functions/` (mirroring the 6f5 core layout), so peripherals now land in the structure, not a monolith. Needs 6f4/6f5. Under-specified + un-split until Phase 6 is done. **Adopted stance: poll sensors, await temporal actuators; incremental peripheral-by-peripheral. BUTTONS DONE (both surfaces, hardware-validated 2026-06-17); next peripheral TBD (agent recommended accelerometer).** Two surfaces per peripheral: brain tile language + the TS user-code `ctx.microbit.*` API (`docs/specs/microbit-context.md`). Edge-connector primitives (GPIO + **I2C** + a **native NEC IR-receive** primitive, locked 2026-06-17, for user-tile libraries like Cutebot; IR is native C++ + pin-parameterized since the round-based VM can't do us pulse timing; SPI excluded - no consumer) live on the TS surface. |
| Phase 8: Virtual Radio in microbit-sim (sim-to-sim) | Placeholder | Let multiple sims in `apps/microbit-sim` exchange **radio** messages by group (the sim transport counterpart of physical RF). Sim + wodal only, no VM/firmware change - radio `send`/`receive`/`setGroup` are Phase 7's radio-family contract; Phase 8 is the in-app bus that delivers packets (enqueue -> drain on a tick, single-entry rule; receive surfaces as a poll). Gate: two sims, same group, one sends -> other receives deterministically. Depends on Phase 7's radio family. |
| Phase 9: ELECFREAKS Cutebot via TS user-tiles | Placeholder | A TypeScript **user-tile** library driving an ELECFREAKS Cutebot robot car, modeled on the `pxt-cutebot` MakeCode extension (reimplemented, not ported). Actuators over **I2C@0x10** (motors L/R -100..100, servos 0..180, RGB lamps), sensors over **GPIO** (ultrasonic P8/P12, line IR P13/P14, IR remote P16). **Pure TS library on Phase 7's GPIO + I2C + IR-receive primitives - no new native firmware code** (the IR NEC decoder generalized into Phase 7; Cutebot points it at P16 + maps command bytes to buttons). Stance: writes sync, `moveTime` awaits, reads poll. Gate: modeled Cutebot in the sim (host-call trace parity) + real-hardware smoke test. Independent of Phase 8. |

## Workflow Convention

This plan follows the same procedure as
`generated-docs/wodal-first-vertical-slice-plan-2026-05-13.md`. Work proceeds
phase by phase. A phase is not started until the previous phase is accepted or
explicitly skipped in this document.

For each phase:

1. Review the phase goal, scope, decisions, invariants, out-of-scope, and gate.
2. Update `Status` to `In progress` and set `Current focus` to the phase.
3. Resolve every "Decisions to lock" item for the phase before writing code.
   Treat any ambiguity in a wire format, an ABI slot, or an opcode semantic as a
   blocking issue and resolve it in the plan first.
4. Do only the work needed for that phase - and no more. **Scope = the gate**
   (Locked Decision 9): build only what a gate check exercises; if nothing in the
   gate touches a field, branch, check, or abstraction, do not build it. Anything
   beyond the gate requires the burden-of-proof test in Locked Decision 9.
5. **Subtraction pass** (Locked Decision 9): before gating, attempt to delete each
   thing built; if no gate check breaks, remove it. Removal is the default.
6. Run the phase gate checks.
7. Summarize the result for review.
8. After acceptance, update `Status` to `Accepted` and add one dated `Phase Log`
   entry with: what changed, checks run, follow-up decisions or blockers.
9. Set `Current focus` to the next phase.

If a phase reveals that the plan is wrong, pause implementation and update the
plan before continuing. Do not silently expand a phase. Large phases may be split
into subphases, but the split must be recorded in the plan before implementation
starts.

## Progress Rules

- **Minimum-mechanism (Locked Decision 9):** build only what the phase gate
  exercises; speculative robustness - versioning, integrity, identity/compatibility,
  future-proofing, pre-sizing, taxonomy inflation - is out of scope by default and
  needs a concrete, possible-today failure mode (not already caught elsewhere) to be
  included. A subtraction pass precedes every gate. When unsure, leave it out.
- Keep at most one phase `In progress`.
- Do not mark a phase `Accepted` until the user has reviewed it or explicitly
  delegated acceptance.
- Do not add compatibility aliases. When a symbol changes during the plan, update
  its clients in the same phase.
- The binary `.mcprogram` format and the device ABI (the statically declared ids) are
  shared TS <-> C++ contracts. A change to either is contract-shaping: update the
  format / id enums, the TS serializer, the C++ reader/mirrors, and the fixtures in
  the same unit.
- When changing an opcode, operand semantic, value semantic, host calling
  convention, handle behavior, or error code, update the VM contract
  (`external/mindcraft-lang/docs/specs/contracts/vm-contract.md`) in the same
  unit, per `vm.instructions.md`.
- Stable diagnostic codes are primary; human-readable messages are convenience
  text only. ASCII-only in code, comments, and display/log strings.
- No process-global mutable state in C++. The VM, scheduler, runtime, and device
  are instances; a process (host test harness) may host more than one.
- The C++ host binding tables mirror the TS statically declared ids and are guarded
  by parity tests; no magic numbers outside the mirrored declarations. Do not
  hand-author a `.mcprogram` artifact: test `.mcprogram` inputs come from the build
  path, not hand assembly.

## Final Slice Definition

The C++ VM slice is complete when:

1. The same committed `button-display.mcprogram` (in its binary form) is parsed
   and executed by the C++ VM on a real micro:bit v2.
2. Pressing button A toggles a display pixel, matching the TS simulator's
   observable behavior for the identical program and input sequence.
3. A parity harness runs that program (and a small golden set) through both the
   TS VM and the host-portable C++ VM and asserts matching observable behavior.
4. The program reaches the device as a patched, distributable `.hex` - via a file
   the user flashes (browser download or `wodal` CLI), and via in-browser WebUSB
   direct flashing. (There is no resident serial loader; that model is deferred -
   see Deferred Work.)

The slice does not require full opcode conformance (Phase 6), additional host
actions beyond the existing two, additional device profiles, or the VS Code
bridge. Those are later phases or Deferred Work.

Note on conformance: the VM contract forbids opcode subsetting for a *conforming*
VM. Phases 1 through 5 build an intentionally incomplete VM that runs the
`button-display` subset and faults deterministically (an `ErrorCode.ScriptError`
fiber fault, never silent mis-execution) on any opcode it has not yet
implemented. Phase 6 brings the C++ VM to full contract conformance. The plan
treats "runs the slice" and "conforms to the contract" as two distinct,
sequenced bars.

Bytecode actions are first-class, not deferred. microbit-v2 supports user-tile
(bytecode) actions, so real microbit-v2 brains
contain bytecode action bodies - arbitrary authored code compiled to bytecode,
which can use *any* opcode. Supporting them therefore requires (near-)full opcode
coverage plus the bytecode-action execution machinery (the `ACTION_CALL` bytecode
branch, the initializer/activation/deactivation funcId hooks, and
`LOAD`/`STORE_CALLSITE_VAR`). So Phase 6 is **on the critical path to a usable
microbit-v2**, not optional polish; the host-only `button-display` slice is
first-light to prove the pipeline, not a representative endpoint. The Value model,
action model, and binary format are designed for bytecode actions from the start
(see the `actions[]` rationale in Prep A).

## Locked Decisions

These foundational decisions shape every phase below. **Decision 9 (Minimalism) is
the governing default** behind the specific prohibitions in 7 and 8 - read it
before adding any field, check, format, or abstraction in any phase.

1. **Binary `.mcprogram` codec: in core, on raw var-int primitives.** The
   binary serializer/deserializer (`brain-program-binary-codec.ts`) lives in
   `mindcraft-lang` core beside the JSON codec, built on **raw var-int (LEB128)**
   primitives added to `stream.ts`. The framing is **codec-local and flat** - a
   4-byte magic + 1-byte format version + profileId var-uint + 1-byte presence
   bitmask, then positional, var-int-packed section bodies in a fixed order. The
   generic `stream.ts` tagged-chunk mechanism is **not** used for the section frame:
   its fixed 13-byte-per-chunk header dominated small images. The C++ reader (Phase
   2) mirrors this flat format byte-for-byte. (See Prep A for the locked layout.)

2. **Host ABI: statically assigned stable ids, declared as source literals (no
   manifest, no codegen).** The full host-function ABI - the core operators,
   conversions, and builtins referenced by `HOST_CALL`, plus the core + target host
   actions referenced by `HOST_ACTION_CALL` - is the contract. Every registration
   carries a **required numeric id (u16), statically declared in source**: funcIds
   as members of explicitly-valued enums (`CoreFuncId` in core `runtime/abi-ids.ts`;
   `MicroBitV2HostFuncId` in wodal; `SimFuncId` in apps/sim), and host actions as
   per-module **record tables** (`CoreHostActions`, `MicroBitV2HostActions`,
   `SimHostActions` - one `{key, actionId, fnId}` record per action, the single
   declaration of the action's string key and ids; registration sites spread the
   record; the `HostActionIds` interface lives in core `runtime/abi-ids.ts`).
   Exactly the struct field-id pattern (`ContextField`, `MicroBitField`). Because
   the id is a source literal it is intrinsically **append-only**: adding, removing,
   or reordering a registration cannot shift another's id; removal leaves a
   permanent gap (never reused, by convention). The C++ dispatch tables are
   **hand-maintained mirrors of the same values** (C++ enums/constants; for actions,
   an `{actionId -> body}` table mirroring `<Module>HostActions`); there is no
   checked-in manifest and no codegen step. Drift safety comes from in-build
   validation (non-negative integer, unique per space, inside the owner's range,
   enforced via a `withOwner("core" | "target" | "dynamic")` registration scope,
   default `"target"`), and TS-registry-equals-C++-bindings parity tests - which
   are the **sole and sufficient** ABI drift guard. (There is **no** `abiVersion`/
   `abiDigest`/`firmwareId` or any compatibility version/digest/identity check, ever
   - permanently removed, see Locked Decision 8.) **String keys are a build-time
   concept only; the device binds and dispatches purely by stable numeric id** (no
   strings on the MCU). The codec serializes host/action references by stable id
   (see Prep A), so neither VM depends on registration order.

   **This unifies every device-ABI identity on one mechanism** - host-function ids,
   host-action ids, struct nominal type-id atoms, and struct field-ids are all
   statically declared source literals (enum members or record-table fields) at
   their declaration sites, all mirrored the same
   way on the C++ side, all guarded the same way. There is **no manifest, no
   codegen, no allocator, and no registration-order counter** anywhere in the
   device ABI.

   **Layered id spaces are partitioned by reserved ranges.** Core host functions
   and the active target's native methods dispatch through the single `HOST_CALL`
   funcId space (one shared `IFunctionRegistry`), partitioned: core
   `[0, TARGET_FUNC_ID_BASE)` for target-agnostic expansion of the core lib; target
   `[TARGET_FUNC_ID_BASE, DYNAMIC_FUNC_ID_BASE)`; dynamic
   `[DYNAMIC_FUNC_ID_BASE, ...)`. Constants exported from core `runtime/abi-ids.ts`:
   `TARGET_FUNC_ID_BASE = 1024`, `DYNAMIC_FUNC_ID_BASE = 65536`,
   `TARGET_ACTION_ID_BASE = 1024`. The **host-action space is partitioned the same
   way**: core registers 8 host actions (sensors `random`, `on-page-entered`,
   `timeout`, `current-page`, `previous-page`; actuators `switch-page`,
   `restart-page`, `yield`) at action ids 0-7, and the target owns
   `[TARGET_ACTION_ID_BASE, ...)` - so the C++ side needs a **core action table plus
   a target action table** (two dense arrays, like the funcId tables). Targets never
   coexist on a device (the `.mcprogram` `profileId` selects one), so **all
   targets share the target range** - the same precedent as the `Context`
   extension field id (6) being `self` in apps/sim and `microbit` in wodal. The
   registries validate the range at registration via the `withOwner` scope. The
   **dynamic funcId region is explicitly NOT device ABI**: user-enum
   conversions/operators register there with program-dependent ids (derived
   `DYNAMIC_FUNC_ID_BASE + 4k`, reset each project compile), so a device cannot
   bind them from static tables - user-enum *type* identity travels in the
   per-program type table instead (program-local enum entries carrying name +
   ordinal-defining symbols). The nominal type-id atom space partitions the same
   way: `CoreTypeAtomId` (0-11) below `TARGET_TYPE_ATOM_BASE = 1024`,
   `MicroBitV2TypeAtomId` (1024-1027) / `SimTypeAtomId` above it, validated via
   the `TypeRegistry`'s own `withOwner` scope; dynamic/user types are atom-free
   (enforced).

   **Host actions are called by stable id.** The id is assigned at registration; the
   action registry is id-keyed (`BrainActionRegistry.getById`); the compiler emits
   the call carrying the id; both the TS core VM and the C++ VM dispatch host actions
   by that id. **Separate opcodes**: `HOST_ACTION_CALL = 44` / `HOST_ACTION_CALL_ASYNC =
   45` with operands `<actionId, argc, callSiteId>`; `ACTION_CALL = 42` /
   `ACTION_CALL_ASYNC = 43` remain for bytecode actions (by `actionSlot`).
   **`Program.actions` is bytecode-only** (bytecode actions are program-local:
   `entryFuncId` + lifecycle funcIds, no stable id). **`actionCallSites` is a
   host/bytecode union**: host `{callSiteId, actionId}`, bytecode `{callSiteId,
   actionSlot}`; page-lifecycle resolves host hooks by id from the registry and
   bytecode hooks by slot. The stable id is the runtime identity end-to-end; there
   is no serialize-time rewrite / encoding-dependent operand. The C++ VM mirrors
   this contract (read `bytecode.ts`, `vm-contract.md`, `brain-program-codec.ts`,
   `action-registry.ts` for the authoritative shapes).

   **Id assignment: a required `id` on the registration, statically declared in
   source.** The host-function and host-action registration inputs require an
   explicit id (mirroring `StructFieldInput.id`); the registration-order counters
   are removed. Every core + target registration supplies its id from the
   declarations above. `EnumTypeShape` requires a `functionIds` block
   (`{toString, toNumber?, equalTo, notEqualTo}`), so even per-enum-type function
   registrations carry explicit ids (user enums derive theirs in the dynamic
   region). Assignment operator overloads register **no host function**
   (`OpOverload.fnEntry` is optional; assignment overloads are type-only - both
   compilers lower assignment to stores). The source literal is the cross-build
   pin, so serialized / ABI targets (microbit-v2, any persisted `.mcprogram`) stay
   stable, while removal leaves a permanent gap by convention (never reused).
   In-process consumers (`apps/sim`, `microbit-sim`) carry explicit ids the same
   way (they rebuild from source and never persist ids; `apps/sim` compiles from
   `BrainDef` source and never deserializes a `.mcprogram`). The C++ mirrors +
   parity guards land with Phases 3/4.

3. **Toolchain: host-portable core plus CODAL device target, two build trees.**
   The VM core and binary reader are platform-independent C++, buildable and
   unit/parity-testable on a desktop host (the parity oracle runs in CI without
   hardware) via a plain CMake build. The device target builds on the micro:bit
   CODAL runtime (reusing `MicroBitDisplay`, `Button`, `MessageBus` drivers the TS
   sim already mirrors) using the official `microbit-v2-samples` scaffold: a
   `source/` folder (which `#include`s and compiles our `cpp/core/`) plus a
   `codal.json`, built by that project's `python build.py` (a CMake wrapper that
   also fetches the CODAL libraries). The two builds coexist: the same portable
   `cpp/core/` is consumed by both the desktop CMake test tree and the device
   `source/` folder; there is no single CMake tree driving both. All C++ lives
   under a new top-level `cpp/` (already referenced by `vm.instructions.md`
   `applyTo`).

4. **Deploy: a patched full-`.hex`, by download/CLI or WebUSB (no resident
   loader).** Every deploy is a complete patched hex (the `.mcprogram` written
   into a prebuilt firmware's reserved flash region); there is **no resident
   runtime / on-device program upload** (the serial-loader model is deferred
   indefinitely - see Deferred Work; the web patcher + full-hex flashing
   suffice). Delivery:
   - *File* (the `wodal` CLI in Phase 5b; the microbit-sim Blob download in 5c):
     emits a distributable `.hex` the user flashes by drag-drop to the MICROBIT
     drive.
   - *WebUSB* (Phase 5c): `apps/microbit-sim` flashes the patched hex directly
     over WebUSB/DAPLink - same hex, no manual drag-drop (Chromium-family
     browsers; the file path is the fallback).
   There is **no** firmware<->program ABI compatibility check anywhere - no
   patcher check, no boot check, no version-ping. It is unnecessary by construction
   (one repo, one firmware, one ABI) and permanently removed; see Locked Decision 8.

5. **Heap: precise mark-sweep at safe points over the dynamic pools.** `cpp/core/`
   represents `Value` as a POD tagged union (primitives inline, reference types as
   typed pool index/handles) and reclaims heap objects with a precise tracing
   collector that runs only at GC-safe points (instruction/think boundaries, made
   quiescent by single-entry) over `Pool<T>` instances drawn on demand from the
   shared region (Locked Decision 7 - never fixed-capacity). It handles cycles
   natively, adds no refcount churn to the hot path, preserves aliasing, and
   reproduces the contract's struct deep-copy sites exactly (`STORE_VAR_SLOT`, the
   name-keyed `SET_FIELD` fallback, and the explicit `STRUCT_DEEP_COPY` opcode -
   `STRUCT_SET_FIELD` itself is a pure store). See Heap And Value
   Memory Model for the full model. Representation lands in Phase 3; the collector
   + list/map backings land in Phase 6a (dynamic-string backing in 6c, struct
   deep-copy in 6b).

6. **Numeric model: per-profile precision, set at core operator registration;
   reference follows hardware.** Numeric semantics are a device-profile property,
   not universal. A numeric-precision indicator is passed into `mindcraft-lang`
   core's operator and conversion registration, and core registers precision-
   appropriate implementations behind the stable, **precision-agnostic** operator
   ABI ids (the compiler resolves `add(number,number)` to one id; that id binds to
   the profile's `add`). **microbit-v2 declares f32** (single number type; bitwise
   coerces via i32/ToInt32 and the stored result rounds to the profile precision). The TS reference for microbit-v2 models f32 bit-
   exactly (`Math.fround` / `| 0` / `Math.imul`), so the **oracle follows the
   hardware** rather than the device emulating V8's f64; the C++ device uses the
   native M4F FPU. Per-target parity is the bar (TS-sim-for-profile ==
   C++-for-profile); cross-profile numeric identity is not guaranteed. Device-field
   widths (uint8/uint16/int32/...) are modeled separately at the host/device
   boundary by `packages/wodal/src/core/numeric.ts`, independent of and consistent
   with this. Trade-off: f32 integer exactness caps at 2^24 (fine for tile-brain
   counters/indices); a future profile may select f64 by the same knob. This adds a
   precision parameter to `mindcraft-lang` core operator/conversion registration.

7. **Dynamic-first memory: allocate on demand, never pre-size.** All runtime
   memory is drawn on demand from one per-runtime arena (`cpp/core/`'s
   `RegionArena` - the device's single block of VM working RAM). Two clients sit
   on it: a **forward bump** for permanent, program-lifetime data (the decoded
   program image and program-sized slot tables), and one **`Pool<T>` template**
   for every individually-managed object (fiber records, fiber workspaces, and -
   as the heap lands - value containers and handles), each a slot carved from
   the region on first use and recycled through a free list on release. There is
   exactly one allocator and one pool template; a dormant slot costs zero bytes;
   the region is a single fixed block whose size N is the one RAM number a target
   picks.

   **How a target obtains that block is target-specific - and a CODAL target must
   NOT claim free SRAM** (the original framing, corrected 2026-06-13 from the 4b
   hardware finding). micro:bit v2 builds with `DEVICE_PANIC_HEAP_FULL=1` (pinned
   in `target-locked.json`), so `device_malloc` *panics* (native "020") instead of
   returning NULL - a heap probe is impossible - and CODAL co-owns the heap with
   unbounded boot-time demand, so claiming free SRAM starves it (tried; failed on
   hardware). A CODAL target instead reserves the region as a **static `.bss`
   partition** (`uint8_t g_vmRegion[N]`): the linker splits RAM, the VM gets N,
   CODAL keeps the rest - no co-tenancy, no probe. **N is an irreducible budget
   split** (microbit-v2: currently 32 KiB), not "all free SRAM." (A bare-metal,
   non-CODAL target with sole heap ownership could claim free SRAM instead; that
   is a per-target choice.) This does **not** weaken dynamic-first: within N the
   arena + `Pool<T>` still carve on demand and recycle (a dormant slot is still
   zero bytes); N bounds total VM memory, and exhausting it faults
   `StackOverflow`-class -> fault mode. `kMax*` guards still reserve nothing.

   **Cap-sized and worst-case buffers are forbidden.** No fixed-capacity pool,
   no `T array[kMax...]` reservation, no `fibers x caps` product, no "size the
   pool to the cap" anywhere in `cpp/core/`, `cpp/codal/`, or a target. **Every
   `kMax*` constant - and every profile bound (`maxFibers`, `maxStackSize`,
   `maxFrameDepth`, `maxHandlers`, `maxHandles`, the heap pool caps) - is an
   upper bound checked at runtime: a deterministic-fault guard, never a
   pre-allocation size.** Crossing one faults `ErrorCode::StackOverflow` (which
   the device host loop latches into fault mode); running out of the region
   faults the same way. Memory exhaustion is the only structural limit, so a
   generous guard is free (a 100- or 10000-fiber `maxFibers` reserves nothing).

   The prohibition is about the *source of the size*, not about fixed arrays as
   such: an allocation sized to an **exact, known count where every slot is
   filled** - the program's variable count, a page's root-rule count - is fine
   and expected (the context slot tables and `BrainRuntime.ruleFibers_` are
   exactly that, sized from the program at load). What is forbidden is sizing to
   a **cap, max, or worst-case bound** that leaves slots unfilled. Size to actual
   demand; never to a ceiling.

   **One tracked exception, removed in Phase 6e:** a fiber's `FiberWorkspace`
   (operand stack + locals + frame regions) is still a single full-cap block
   sized by `kMaxStackSize`/`kMaxLocalsSize`/`kMaxFrameDepth`, because the
   dispatch loop indexes those regions contiguously by depth. Phase 6e's
   grow-on-demand stack arena replaces it with regions that grow by realloc
   (reusing the list-backing/slab pattern), keeping them contiguous; until then
   this is the *only* permitted pre-sized buffer, and no new one may be introduced.

   **Review gate:** reject any change that sizes storage to a cap, max, or
   worst-case bound, or uses a `kMax*` (or any cap) to size storage rather than
   to guard a runtime check. A `T array[kMax...]`, a pool sized to a cap, or a
   `x maxFibers` product is the smell to stop on - an array sized to an exact,
   fully-used count is not. This principle holds against the recurring pull to
   re-establish cap-sized pools; that pull is to be resisted, not accommodated.

8. **No firmware<->program ABI compatibility machinery - permanently removed,
   never to return.** There is, and will be, **no `abiVersion`, no `abiDigest`, no
   `firmwareId`**, and **no version, digest, fingerprint, build-id, handshake, or
   identity field/check of any kind** whose job is to decide whether a `.mcprogram`
   is compatible with - or built for - a given firmware: not in the on-flash
   header, not in the build->patcher metadata, not in a `.mcprogram` envelope, not
   at patcher package time, not at boot, not over any wire. This was considered,
   designed, and **removed** (it bloated Phase 5a, then was cut from Phase 5b by the
   2026-06-13 over-build audit). It is **NOT deferred**: there is no future phase,
   no trigger, no "when multi-version distribution is real" that brings it back.

   **Why it is unnecessary, permanently:** one repo, one firmware, one ABI - a
   `.mcprogram` and the firmware that runs it are built from the same source tree,
   so a compatibility mismatch **cannot occur by construction**. The only real
   failure such machinery ever named - C++/TS ABI mirror drift - is already caught
   at build time by the **TS-registry-equals-C++-bindings parity test** (field by
   field: id, key, kind, arity, ordered slot types, `isAsync`, result type; a
   missing or drifted mirror fails CI). That parity test is the **sole and
   sufficient** ABI drift guard; nothing at runtime, package time, or on flash adds
   anything it does not already provide.

   **What stays (do not conflate):** the stable-id ABI identity model (Locked
   Decision 2) and its parity test; the on-flash **presence magic** `"MCFR"` (it
   only distinguishes a written region from erased flash - not an identity or
   compatibility token); and the patcher's **size bounds-check** (does the program
   fit the region). None of these is compatibility machinery.

   **Review gate - block the urge to design it back in.** Reject, on sight and
   without re-litigation, any change OR proposal - in any guise, under any new
   name - that adds a firmware/program/metadata version number, content digest,
   build id, fingerprint, checksum-for-identity, handshake, version-ping, "minimum
   ABI" field, or any field/check that decides whether a program *matches* or is
   *compatible with* a firmware. The recurring pull to slip in "just a small
   compatibility check / digest / version byte, for safety" is precisely what this
   decision exists to stop: it is to be resisted, not accommodated, and not
   "left room for." If multi-firmware distribution is ever genuinely contemplated,
   that is a new product decision the **user** raises explicitly - it is never to be
   pre-built, scaffolded, reserved for, or anticipated in the meantime.

9. **Minimalism (least-mechanism): the governing default. Build the minimum the
   gate exercises; speculative robustness is out of scope.** This is the principle
   behind Locked Decisions 7 (no pre-sized pools) and 8 (no ABI compatibility
   machinery) - they are *instances*; this is the parent rule, applying to every
   phase, contract, format, error set, and abstraction in this plan. Over-build -
   gold-plating with machinery for problems that cannot occur in the system as it
   exists today - has been the recurring failure here; this decision is the standing
   countermeasure.

   **Burden of proof is on inclusion, not omission.** For every field, check,
   version axis, error code, abstraction, parameter, or guard you are about to add,
   name the **one concrete failure mode - possible in the system as it exists today
   - that it prevents AND that no existing layer already catches.** If the only
   justification is a future scenario, a general good ("robustness", "safety",
   "completeness", "flexibility"), symmetry / "while we're here", or something an
   existing layer already guarantees, **it is cut by default.** The unifying
   diagnostic for over-build: *it defends against a state that cannot occur today.*
   (Already cut by this rule: the 5a header checksum - the reader already faults on
   corruption; the 5a length field - the format is self-delimiting; the 8-code
   RegionError taxonomy - cut to the 3 codes the boot path can reach; all ABI
   version/digest/id machinery - Locked Decision 8.)

   **Scope = the gate.** A phase builds exactly what its acceptance gate exercises -
   no more. **If no gate check touches it, do not build it.** This is the objective
   form of the rule: it is decidable *before* writing the code (does a gate test
   reach this field / branch / abstraction?), and it is what every cut above had in
   common - nothing in the gate exercised them.

   **Banned by default (the recurring tells - each needs an explicit, today-failure-
   mode justification to include):**
   - *Redundant integrity:* checksums, CRCs, length/size fields duplicating a
     guarantee an existing decoder / reader / allocator already enforces.
   - *Compatibility / identity:* version numbers, content digests, build/firmware
     ids, fingerprints, handshakes, "minimum-X" fields - in a single-build,
     single-version, matched-pair world (the ABI case is Locked Decision 8).
   - *Future-proofing:* reserved fields, "vN room", envelopes, plugin seams, or
     abstraction layers for a hypothetical second consumer / target / profile that
     does not exist yet.
   - *Defensive validation:* validators for inputs that cannot be malformed
     (same-build producers); depth / size caps for non-adversarial input.
   - *Pre-sizing:* fixed-, cap-, or worst-case-sized buffers and pools (Locked
     Decision 7).
   - *Taxonomy inflation:* error codes, states, or config knobs beyond those a path
     can actually reach or a caller actually sets.

   **Subtraction pass before every gate** (a standing Workflow Convention step):
   attempt to delete each thing built; if no gate check breaks, remove it. Removal
   is the default action, not a special event.

   **Review gate - resist the pull, do not accommodate it.** Reject, on sight, any
   addition or proposal that fails the burden-of-proof test, in any guise or under
   any "it's just a small ..." framing. When unsure whether something is needed,
   leave it out and let a real, failing gate test pull it in: adding it later when a
   test demands it is cheap; carrying speculative machinery costs the recurring
   simplification pass this decision exists to eliminate.

## Ownership Boundaries

- `mindcraft-lang` core owns: the binary `.mcprogram` format contract, the TS
  binary serializer/deserializer (beside the JSON codec), the byte-stream
  primitives, the **core host-function ABI** (operators/conversions/builtins, with
  statically declared stable ids, mirrored in C++), and the VM contract document. The
  format and
  the core host-function ABI are Mindcraft product contracts, not WODAL details.
- `packages/wodal` owns: the microbit-v2 host-action declarations and registry (with
  statically declared stable ids), the **target ABI id declarations**
  (`MicroBitV2HostActions` + the native-method funcId enum + field-id layouts), the
  `.mcprogram` envelope (`profileId` tagging), and
  the `wodal`
  CLI seam that drives build ->
  deploy -> flash / hex / serial.
- `cpp/core/` owns: a slim, target-neutral native port of `mindcraft-lang`
  core's `platform/` + `runtime/` layers plus the binary `.mcprogram` codec -
  the native byte stream and common primitives, the value model, interpreter,
  scheduler, handle table, and the `.mcprogram` reader. It has no CODAL/device
  dependency and defines the host-function/action *interfaces* (the C++ analogs
  of `IFunctionRegistry` / `ExecutionContext` / `HostSyncFn`). It is reusable by
  every device target. It is a hand-maintained parity port (not transpiled from
  TS), kept in sync by the three shared contracts (binary format, device ABI id
  enums, VM contract doc) and the parity suite. It does NOT port the compiler, linker, type
  inference, or authoring - those stay TS-side (compilation happens on the
  web/compiler side).
- `cpp/codal/` owns: the CODAL-common, board-agnostic layer - the bridge from
  `cpp/core/`'s host-function interfaces to CODAL's event/fiber model (the
  enqueue-only `MessageBus` -> queue -> `think()` host loop) and packaging
  patterns. (The resident-runtime machinery - serial protocol, VFS, program
  loader - is deferred indefinitely; see Deferred Work. If revived it lives
  here.) Depends on `cpp/core/` + CODAL; **no board specifics** (enforced - see the
  board-agnostic guardrail in Multi-Target Structure). **Built in this work unit**,
  not deferred to a second target.
- `cpp/targets/<board>/` owns: the board-specific host layer for one device -
  the `codal.json` selecting that board's CODAL target, the `abi/` (the board's
  mirrored ABI id enums + binding table + the hand-written C++ action bodies binding
  to that
  board's peripherals + native struct methods), the board flash-region layout, and
  the firmware `source/` (which wires the board's devices into `cpp/codal/`'s host
  loop). `cpp/targets/microbit-v2/` is the first; `cpp/targets/raspberry-pi/`
  follows. Each depends on `cpp/core/` + `cpp/codal/`, never the reverse.
- The statically declared ABI ids are the only sanctioned bridge from a WODAL device
  profile's registry to that target's
  C++ binding table. The mirrored id enums, the binding tables, and the C++ host
  action bodies (CODAL calls)
  live under `cpp/targets/<board>/abi/`, registered against `cpp/core/`'s
  host-function interfaces and parity-tested against the TS registry. One cpp target
  corresponds to one WODAL device profile and one ABI id space.

`mindcraft-lang` is a git submodule under `external/`, on a writable working
branch. Prep A is a submodule change; Prep B and all C++ work are this-repo
changes.

## Multi-Target Structure

The C++ tree separates a host-agnostic runtime from per-host integrations, so the
same `cpp/core/` embeds into very different hosts - an MCU via CODAL, a game
engine, or a native desktop process - without changing core. A "target" is a host
platform, not necessarily a device or a CODAL board. The layout mirrors the TS
`packages/wodal/src/targets/<name>/` convention:

```
cpp/
  core/              # host-agnostic runtime + host-binding interfaces. The
                     #   embeddable library; no host actions, no host loop, no
                     #   CODAL/engine/device deps. Parity port.
  codal/             # CODAL-common, board-agnostic (host-loop bridge,
                     #   serial/VFS/loader, packaging). BUILT in this work unit.
  engine/            # (future) game-engine family substrate. Extracted on the 2nd
                     #   engine. Not built unless/until two engines share glue.
  targets/           # host platforms; each opts into a family substrate or none
    microbit-v2/     #   CODAL board: codal.json, abi/, source/  (this plan's slice)
    arduino-uno/     #   (hypothetical) CODAL board
    godot/           #   (illustrative) game-engine integration
    unreal/          #   (illustrative) game-engine integration
  test/              # desktop parity harness (depends on core)
  tools/             # host tooling (flashers, hex patcher)
```

Rules:

- **`core/` is the embeddable runtime; it knows nothing about CODAL, any board, or
  any engine.** Every target and the desktop harness depend on it; it depends on
  none of them (the C++ import-firewall invariant). Linking `core` into Unreal or
  Godot is exactly its intended non-device use.
- **A target is a host platform (board, engine, or native host).** Each target
  provides three things `core` does not: the host-action bodies, a host-loop
  driver that ticks and drains events, and the binding to that host's world (CODAL
  devices, engine actors/input, etc.). All three live under
  `cpp/targets/<host>/`, never in `core`.
- **One cpp target ↔ one WODAL host/device profile ↔ one ABI id space.** Adding a
  target means a new `packages/wodal/src/targets/<name>/` profile
  with its own host actions (statically declared ids) and a mirrored binding table under
  `cpp/targets/<name>/abi/`. The `.mcprogram` `profileId` selects which target a
  program was built for, so an engine-built binary never loads on a micro:bit and
  vice versa.
- **`cpp/codal/` is built in this work unit (not extract-on-second-use).** The
  CODAL-common machinery (host-loop bridge + packaging; a serial/VFS/loader only
  if the deferred resident runtime is revived) lives in `cpp/codal/` from the
  start, so the board-agnostic boundary is designed cleanly
  rather than retrofitted later. The cost is drawing that boundary with only
  microbit-v2 in hand; the **board-agnostic guardrail** below mitigates it. (Other
  family substrates, e.g. a future `cpp/engine/`, still follow extract-on-second-use
  - they have no first member yet.)
- **Board-agnostic guardrail for `cpp/codal/`.** It must not reference any
  microbit-v2 symbol, peripheral, flash address, `codal.json` target, or action id
  - those live in `cpp/targets/microbit-v2/`. `cpp/codal/` talks to the board only
  through an abstract device-port interface that the target implements. Enforce with
  the same kind of dependency check as the C++ import-firewall (a CI gate), so
  building it with one target doesn't let microbit-v2 specifics leak in.
- **A target opts into the runtime caps and capability surface it needs - not the
  opcode set.** Opcode coverage is universal: every conforming VM implements every
  opcode (the contract invariant; reached at Phase 6 on any target). What varies
  per target is (a) the **region size** it gives the allocator and its runtime
  guard values (`maxFibers` etc.) - an MCU picks a region against tight SRAM, a
  game engine a generous one; neither pre-sizes pools (Locked Decision 7) - and
  (b) the *registered host-function/action set*, i.e. the capability surface. Async is the latter: the compiler emits async
  opcodes only when a host registers an async function/action, so async-using
  bytecode appears only for targets that offer async; the MCU first slice registers
  none (`maxHandles` 0) but still implements the async opcodes once conformant. Same
  `core`, different build configuration - no fork, and no per-target opcode subset.
  (The constrained opcode subset in Phases 1-5 is this plan's phased build-up of
  the microbit-v2 VM, not a target property.)
- **For a device board, "CODAL-supported" is the gating axis, decided per-board.**
  Before a board becomes a `cpp/targets/<board>/` CODAL entry, confirm CODAL
  actually targets it. Three device cases:
  - *CODAL-supported board* (e.g. micro:bit v2 via `codal-microbit-v2`; the Pi
    Pico / RP2040 via `codal-rp2040`, though that target is far less mature) ->
    a `cpp/targets/<board>/` peer + `cpp/codal/`. Verify CODAL target maturity as
    a per-target risk.
  - *Non-CODAL MCU* (e.g. an Arduino Due / Atmel SAM3X, no CODAL target) -> either
    upstream a new CODAL port (significant), or a bare-metal target that binds the
    chip's peripherals directly. Depends on `cpp/core/`, not on `cpp/codal/`.
  - *Non-CODAL native host* (e.g. a Linux SBC, or a game engine) -> a native-host
    platform layer over `core`, closer to the desktop build, with no CODAL
    dependency.

## Heap And Value Memory Model

`cpp/core/` reclaims heap value objects (lists, maps, closed structs, closures
with captures, dynamically-created strings) with a **precise mark-sweep collector
that runs only at GC-safe points** over **`Pool<T>` instances drawn on demand
from the shared region** (Locked Decision 7 - one allocator, no fixed-capacity
pools). The TS VM
relies on the JS GC; the C++ port replaces it with this scheme. Reclamation is
parity-invisible (the value model has no finalizers), so the strategy is an
implementation choice that must only (a) never free a reachable object and
(b) preserve aliasing and the struct deep-copy points exactly.

Representation:

- **`Value` is a small POD tagged union.** Inline / value-semantic members
  (`Number` as `mc_number_t` - the profile's precision, f32 on microbit-v2 -
  `Boolean`, `Nil`/`Void`/`Unknown` singletons, `handle` id,
  small enums) live inside the `Value`. Reference / heap-semantic members (`List`,
  `Map`, closed `Struct`, `Function` with captures, dynamic `String`) hold a
  **typed pool index/handle, never a raw pointer.** This keeps `Value` trivially
  copyable (required by the operand/frame stacks), keeps the program
  image flash-resident, and leaves room to compact.
- **Immutable/constant data is referenced, never owned or freed.** The constant
  string pool and the flash-resident program are roots-by-reference; only
  dynamically created objects enter the managed heap. The `button-display` slice
  creates zero heap objects (inline primitives + constant-pool refs only).
- **The managed heap is `Pool<T>` instances over the shared region**, allocated
  on demand and recycled on release (Locked Decision 7) - no fixed-capacity
  reservation. Exhaustion is a deterministic `StackOverflow`-class fault, never
  UB. Variable-length backings (list/map/struct storage) draw size-classed slabs
  from the same region (exact allocator pinned in Phase 6a).
- **`cpp/core/` implements its own value-level `list`, `map`, and `string`
  types - not STL.** These are the heap backings above: pool-allocated,
  handle-referenced, GC-traced, with in-place mutation and observable aliasing.
  STL (`std::vector`/`std::map`/`std::string`) cannot serve them - it uses the
  general heap, fragments, is not GC-traceable/relocatable, and `std::map`
  (sorted) / `std::unordered_map` (unordered) match neither JS equality nor
  insertion order. They implement exactly the opcode/value-model semantics, not the
  full TS platform `List`/`Dict` API:
  - `list` - `Value` array with `LIST_*` semantics (indices floored to int,
    out-of-bounds read -> `nil`, empty `pop`/`shift` -> `nil`).
  - `map` - `string|number` keys with JS equality (numbers by value -
    SameValueZero, NaN a usable key, +-0 one key; strings by char sequence), backed
    by an **insertion-ordered entry array** (an ordered map, like JS `Map` / the
    platform `Dict`), NOT an unordered open-addressed table. **The hash index is
    deferred (as-built 6a: ordered entry array + linear scan).** It is the *ordered
    layout*, not the index, that avoids a future backing redesign for map-iteration
    opcodes (`MAP_KEYS` / `MAP_ENTRIES`); the index is a parity-invisible lookup
    optimization, added only when a measured large-map cost demands it (LD9 - it was
    omitted at 6a because no gate needed it). The exact JS `Map` ordering semantics
    are pinned now so they are not a surprise when iteration lands: updating an
    existing key's value keeps its position; `MAP_DELETE` removes the key from the
    order; re-inserting a deleted key appends it at the end. No map-iteration opcode
    or map-keys brain builtin exists today, so order is not yet observable from
    bytecode; when such opcodes are added they are a contract change handled in
    lockstep (vm-contract.md + bytecode.ts + both VMs), and this layout already
    supports them. The collector traces keys + values. **String-key equality, as
    built (6a):** borrowed const-pool string keys compare by **constant-pool index**
    (the linker pipeline content-dedupes the string pool, so equal-content keys share
    one index - index compare == content compare for every compiled binary). This is
    a linker guarantee, not a binary-format one, so it holds only for borrowed keys;
    **managed-string keys (6c) must compare by byte content** (equal content,
    distinct heap slots) - see Phase 6c.
  - `string` - dual model: constant-pool strings are immutable and borrowed
    (referenced, never owned/freed), flash-resident; dynamically created strings
    are pool-allocated, owned, and GC'd. Byte encoding follows the binary codec
    (length-prefixed bytes); equality/comparison match TS.
  These value containers live with the value model and heap in `core/runtime/` (or
  a `core/heap/`), NOT `core/platform/` - a deliberate deviation from TS file-for-
  file mirroring, since in TS `List`/`Dict` are generic platform utilities whereas
  here they are GC-integrated runtime value types.
- **Internal/structural collections are a separate, simpler concern, and none
  is pre-sized to a cap (Locked Decision 7).** The functions table, constant
  pools, and variable names are read-only spans over the flash-resident program
  image. The brain-variable and callsite-state slot tables are program-sized
  bump allocations. **Fiber records and workspaces are `Pool<T>` instances**:
  carved at spawn, recycled at reclaim (deterministic lifetime, not GC-traced -
  they are root sources), with `maxFibers` a runaway guard, never a
  preallocation. The run queue is an intrusive FIFO threaded through the records,
  not an array. They do not use the value-container machinery; do not conflate
  the two. The TS runtime's use of platform `List`/`Dict` for this bookkeeping is
  a Roblox-TS portability convenience; `cpp/core/` uses spans, pools, and
  intrusive links and ports no general `List`/`Dict`.

Reclamation discipline:

- **Mark-sweep runs only at GC-safe points** - between instructions and at think
  boundaries - which the single-entry guarantee makes quiescent. The root set is
  fully enumerable: operand stacks, frame locals, variable slots, callsite slots,
  closure captures, pending handle results, and the scheduler's fibers.
- **Allocating opcodes must keep their in-flight operands reachable from a root**
  across a possible collection (no live `Value` stranded only in a C++ local).
  Collection triggers on allocation pressure: alloc-fail -> collect -> retry ->
  fault if still full.
- **Cycles are handled natively** by tracing (mutable containers can reference
  themselves/ancestors; the tracing collector reclaims unreachable cycles, unlike
  refcounting).
- **Aliasing is preserved**: a heap object is shared mutable backing; `DUP`,
  variable stores of containers, and nesting share one backing, and in-place
  mutations are visible through every reference.
- **Structs deep-copy at exactly three sites** - `STORE_VAR_SLOT`, the name-keyed
  `SET_FIELD` fallback (copies inline), and the explicit `STRUCT_DEEP_COPY` opcode
  (the brain compiler emits it before `STRUCT_SET_FIELD`) - a genuine recursive copy
  there and nowhere else. `STRUCT_SET_FIELD` itself is a pure store, never a copy.

Configurability and phasing:

- **Build-configurable region size.** The one RAM number a target picks is its
  region size N: a CODAL target reserves it as a **static `.bss` partition** (a
  budget split leaving CODAL the rest - see Locked Decision 7; microbit-v2 is
  32 KiB), a bare-metal/desktop/engine target may claim a large block.
  Pools and bump allocations draw from that region on demand (Locked Decision 7);
  nothing is sized to a cap. (Opcode coverage does not vary by target - every
  conforming VM implements every opcode; only the region size, the runtime
  guards, and the registered capability surface, e.g. async, differ. See
  Multi-Target Structure.) Same `core`, different region size.
- **Phasing.** The `Value` representation and the typed pool/handle types land in
  Phase 3 (the slice exercises only inline values + constant-string refs, so it
  allocates nothing and collects nothing). There is **no separate GC-safe-point
  seam to build**: the safe points are the between-instruction / think boundaries
  the dispatch + think loops already have, made quiescent by single-entry (Phases
  3-4); the collector simply runs there. The collector itself + the **list/map**
  backings land in Phase 6a; the **dynamic-string** backing + its tracing in Phase
  6c (with the string-producing host functions - no 6a opcode creates a managed
  string); the **struct deep-copy** in Phase 6b - each with its heap-using opcodes.

## Value Layout

`Value` is a tagged union: a small tag plus an 8-byte payload, a trivially-copyable
POD (~16 bytes with alignment). Every variant maps directly from the TS value
model. The field mapping is fixed by parity; the physical packing is the
swappable part (see below).

| TS variant | C++ payload | Notes |
| --- | --- | --- |
| `Number` | `mc_number_t num` | inline number; `mc_number_t` typedef selected by the profile's precision (microbit-v2 = f32, native on the M4F FPU). See Locked Decision 6 |
| `Boolean` | `bool` | inline |
| `Nil`/`Void`/`Unknown` | none | distinct tags (distinct truthiness / `TYPE_CHECK`) |
| `String` | `u32 strRef` | pool ref; const-pool (borrowed) vs dynamic (managed) by range/flag |
| `Enum` | `{ TypeId typeId; u32 ordinal }` | the symbol is a wire-level **ordinal** (the TYPS enum entry's symbol list / the atom enum's declared symbol order defines it), so enum equality is an integer compare (`typeId` + `ordinal`), never a string compare |
| `List`/`Map`/`Struct` | `{ TypeId typeId; u32 handle }` | handle -> container pool; struct pool entry records closed-fields vs native-object slot. Closed-struct fields are a **slot array indexed by numeric field id** (sized `maxFieldId + 1`; retired ids leave reserved nil holes), so `STRUCT_GET_FIELD`/`STRUCT_SET_FIELD <fieldId>` is a direct index. Native structs dispatch field get/set **by field id** (int switch), storing nothing in the slot array |
| `Function` | `{ u32 funcId; u32 captures }` | captures = handle or NONE sentinel |
| `handle` (internal) | `u32 handleId` | async handle |
| `err` (internal) | `u16 code` | only `ErrorCode` is contractual; richer detail via optional handle, deferred |

Sketch:

```
enum Tag : int8_t {            // == NativeType for TYPE_CHECK-visible types
  Unknown=-1, Void=0, Nil=1, Boolean=2, Number=3, String=4, Enum=5,
  List=6, Map=7, Struct=8, Function=11,
  Handle=100, Err=101          // non-colliding: never equal a NativeType operand
};
struct Value {                 // trivially-copyable POD
  Tag tag;
  union {
    mc_number_t num;            // typedef selected per profile; microbit-v2 = f32 (native M4F FPU)
    bool     boolean;
    uint32_t handleId;
    uint16_t errCode;
    uint32_t strRef;
    struct { TypeId typeId; uint32_t ref; } compound;   // Enum/List/Map/Struct
    struct { uint32_t funcId; uint32_t captures; } fn;  // Function
  } as;
};
```

Decision locked: **explicit tagged struct, accessed only through an accessor/
constructor API** (`isNumber`/`asNumber`/`makeList`/`typeId`/...). Opcode handlers
never poke union fields directly, so the physical representation can later switch
to NaN-boxing (8 bytes) or struct-of-arrays stacks (~9 bytes effective) without
touching the interpreter. The simple, directly-auditable representation is the
default; it is not a one-way door.

Pinned design points (from the parity work):

- **Tag encoding serves `TYPE_CHECK`.** That opcode compares `Value.t` to a
  `NativeType` operand, so visible-type tags equal the TS `NativeType` numbers
  (signed, `Unknown=-1`); `handle`/`err` get out-of-range tags so they compare
  false.
- **`typeId` is an integer on device, not a string** (so `INSTANCE_OF`/type identity
  is an integer/handle compare). The binary ships **no typeId strings**: typeId
  operands (`INSTANCE_OF.a`, the four `*_NEW.b`) and `injectCtxTypeIdx` are indices
  into the program's `TYPS` type table. The device interns the table **once at
  load**: atom entries bind to the statically-mirrored atom table (native
  dispatch/codecs); structural and program-local entries become local handles.
  Enum equality is a `(type, ordinal)` integer compare.
- **String refs carry the borrowed-vs-managed bit** (const-pool strings are never
  collected; dynamic strings are), so the collector traces correctly.
- **Singletons are trivial inline constants** (`NIL`/`VOID`/`UNKNOWN`/`TRUE`/
  `FALSE`) - no heap.

RAM consequence and the fiber-stack strategy: a naive per-fiber fixed operand
stack costs `sizeof(Value) x maxStackSize x maxFibers`, which does not scale -
`maxFibers` is a generous runaway guard (not a small constant), so a `x maxFibers`
product is exactly the pre-sized buffer Locked Decision 7 forbids. Fibers are
therefore allocated on demand: each is a `FiberWorkspace` (operand stack + locals
+ frames) and a `FiberRecord` drawn from `Pool<T>` instances over the shared
region, recycled at reclaim, so dormant capacity costs nothing and a generous
`maxFibers` reserves nothing. The remaining pre-sizing is *inside* the workspace:
it is one full-cap block (`kMaxStackSize`/`kMaxLocalsSize`/`kMaxFrameDepth`)
because the dispatch loop indexes those regions contiguously by depth. Most
root-rule fibers run to completion within a tick (single-entry, cooperative) and
free their workspace at the next sweep; only fibers suspended across ticks
(`AWAIT`/`YIELD`) hold one across rounds. Phase 6e's grow-on-demand stack arena
replaces the full-cap workspace with regions that grow by realloc (its first real
load is async's long-lived suspensions) - the one tracked exception to Locked
Decision 7, removed there. If stack memory still presses, NaN-boxing or
SoA stacks recover space behind the unchanged accessor API.

## Parity Surface

Beyond opcode dispatch, these semantics must match the TS reference VM exactly.
They are not forks - they are facts the C++ port reproduces - but they pervade
`core` and must be designed in early, not discovered during Phase 6 debugging.
The TS VM is the oracle for each.

- **Host-function and host-action identity is a stable numeric id, not a string.**
  `HOST_CALL` (core operators/conversions/builtins + target native methods) and
  host-action calls both bind by a **statically assigned, source-literal-declared
  stable id**
  (Locked Decision 2);
  bytecode (user-tile) actions are the exception - program-local funcIds, not stable
  ids. Strings stay build-time; the device dispatches via id-indexed arrays. The
  registries carry these ids as **static source literals at the registration**, so
  the compiler emits them directly and the binary records them **verbatim - no
  serialize-time remap**. Compatibility is verified by the
  build-time parity test, not by translating ids (the cross-version ABI sync check
  is deferred - see Deferred Work). **Dispatch shape:** the
  TS VM does not bounds-check `fnId` against registry size (dense-id assumption);
  `HOST_CALL`/`HOST_CALL_ASYNC` fault on a `getSyncById`/`getAsyncById` miss, which
  also faults cleanly on a sync/async kind mismatch. The C++ VM mirrors the
  existence-check shape, not a bounds check.
- **Numeric/operator semantics follow the profile's precision plus the TS runtime's
  own conventions, not raw IEEE-754.** microbit-v2 is f32 (Locked Decision 6): the
  TS reference models it via `Math.fround`; the C++ device uses native f32. NaN
  operands collapse to `nil` (`safeNumBinary`), NaN comparisons return `false`,
  `div`/`mod` by zero produce NaN and thus `nil`; bitwise ops coerce via
  i32/ToInt32 (precision-independent mechanics) and the **stored result rounds to
  the profile precision** (a >24-bit integer rounds at f32 - ratified with Prep
  C). The C++ operator functions port these exec
  bodies semantically line-for-line. f32 basic ops (`+ - * / sqrt`) are correctly-
  rounded, so native C++ f32 and TS `Math.fround` agree bit-for-bit. The `numbers`
  constant pool is **stored at the profile's precision** (the `.mcprogram` is
  profile-tagged): for microbit-v2 (f32) the build rounds each literal to f32 and
  encodes small-int or f32 - **never f64**; an f32 device decoder **rejects** an f64
  numeric entry. So the f32 device never receives precision it would discard, and
  constants need no runtime rounding (operator *results* still round per Locked
  Decision 6). The same rule applies to numbers nested in the value pool.
  (Binary only: JSON-hydrated in-process loads are **not** profile-rounded - an
  accepted seam recorded in Prep C; the parity harness uses binary fixtures.)
- **Transcendental math (`pow`, `sin`, ...) - the device is canonical, the
  reference follows.** `libm` transcendentals are not correctly-rounded and differ
  across implementations, so they must be pinned: choose one f32 implementation as
  the spec and make both the device and the TS reference (`MathOps.pow` etc.) match
  it. Reference-follows-hardware makes this the tractable direction (implement once
  for the device, mirror in TS) rather than reverse-engineering V8.
- **Number<->string formatting - same reference-follows-hardware approach.**
  number->string is shortest-round-trip for the profile's precision (f32 for
  microbit-v2); pin one formatter as canonical (a Ryu/Grisu f32 variant) and have
  both the device and the TS reference produce it. `std::to_string` / `printf("%g")`
  do not qualify. string->number uses `parseFloat`-style parse with NaN -> 0.
  Treat as a dedicated, fixture-tested component shared in spirit by both sides.
- **RNG is a fixed LCG.** `seed = (seed * 1664525 + 1013904223) mod 2^32`, output
  `seed / 2^32` in `[0, 1)`. The C++ must use exact 32-bit unsigned arithmetic and
  the identical per-brain seed source (`services.app.rng`); any program using
  randomness diverges otherwise. Pin the seeding model.
- **No deep-equality to design.** Lists, maps, and structs have no `==`/`!=`
  (compile-time rejected); only bool/number/string/nil are comparable. The C++
  implements equality for primitives only.
- **Type identity is split: the per-program type table is serialized; behavior is
  environment-provided.** A program carries its `types` table (`TYPS` in the
  binary): atom refs to the statically declared core/target type atoms, structural
  nodes, and program-local struct/enum entries. The TS runtime resolves table
  indices to its string `typeId`s through the table; the device interns the table
  to integer handles at load. Native-backed field getters/setters, struct type
  *behavior*, and the atom table itself are reproduced from the same module
  registrations as the operator set (core + target), never read from the program.
- **Scheduler ordering is observable, so it must match.** FIFO run-queue order,
  **round-based ticks** (Prep C: every fiber runnable at tick start gets exactly
  one budget-slice; anything enqueued during the tick - a new spawn, a
  `YIELD`/budget re-enqueue, or a handle resume - joins the NEXT round, so
  `YIELD` deterministically
  resumes next think and no rule can be starved), the per-profile
  `defaultBudget` (TS default 1000; the microbit-v2 profile pins its own value),
  and rule respawn order (completed **and faulted**
  rule fibers respawn on the next think - a fault kills the fiber, not the rule)
  govern how side effects
  from different fibers interleave; the C++
  scheduler reproduces them with the identical config the profile pins on both
  sides. There is **no `maxFibersPerTick`** - an invocation cap has a silent
  starvation mode (rules that simply do not run that think) and was removed in
  favor of the structural per-round guarantee; per-tick work is bounded by
  `liveFibers x defaultBudget`. These are not free tuning knobs.
- **Lesser, still pinned.** String ops follow JS UTF-16 semantics (length/index)
  where exposed; `time` / `dt` / `currentTick` are parity *inputs* the harness must
  feed identically to both VMs; async handle resume ordering (Phase 6h) must match.

## Parity Transport (cross-phase infrastructure)

How the two sides actually compare - specified once, consumed by Phase 2 (decoded
structure), Phase 3/6 (behavior), and Prep B (ABI bindings). The mechanism is
**committed golden text artifacts, generated by the TS side, byte-compared by C++
tests** - no live TS<->C++ process bridge, no JSON parser in C++:

- **Canonical program dump.** Both sides implement a deterministic, line-oriented
  text dump of a decoded program (functions, instructions with operands, pools,
  type table, actions, pages - one canonical formatting, ASCII, LF). The TS dump
  is committed beside each `.mcprogram` fixture (as `<fixture>.mcprogram.dump`;
  dump format v1, versioned independently of the binary format); the C++ reader
  test decodes the
  binary and byte-compares its own dump. This is Phase 2c's gate mechanism
  (the format + TS generator are Phase 2a - see `brain-program-dump.ts`) and
  doubles as the decoder's debugging tool. **Numbers render as bit patterns (hex
  u32/u64), never decimal** - the pinned formatter does not exist until Phase 6d
  and platform float rendering varies, so decimal output would make the dumps
  nondeterministic exactly where determinism is the point. The same rule applies
  to the observable trace.
- **Scripted input.** A deterministic schedule of ticks, each with optional
  device-input events (e.g. `tick 3: buttonA down`) and the `time`/`dt` stamps,
  fed identically to both VMs. **For Phase 3 this is mirrored in-code** (a
  ~10-line schedule embedded in the TS spec and the C++ test, cross-referenced;
  drift is self-policing - diverging inputs fail the trace gate loudly): a
  shared script FILE format + a C++ parser for one fixture's ten lines would be
  over-build. The **shared script-file format lands at Phase 6j**, where the
  golden suite (many programs x many scripts) gives it real consumers and
  hand-mirroring stops scaling.
- **Observable trace.** Both VMs emit a deterministic, line-oriented trace of
  observable effects (host-action calls with resolved args, display writes,
  faults with codes, per-tick boundaries). TS generates the committed golden; the
  C++ parity test runs the same program + script and byte-compares. An optional
  instruction-level trace mode (per-instruction pc/op/stack-depth) is the
  divergence-localizing escalation, added in Phase 6j.
- **ABI binding comparison** (Prep B's guard): the **field-by-field parity test**
  is the cross-side check - every registered TS id has a C++ binding with a
  matching signature (id, key, kind, arity, ordered slot types, `isAsync`, result
  type), and no C++ binding lacks a TS registration; a TS-side completeness test
  covers the registry. No C++ table dump is read by TS. (There is **no `abiDigest`**
  - in any form, build-time or runtime; permanently removed, see Locked Decision 8.)
- **Ownership:** the TS-side generators (dump, trace, script runner) are
  TS work, living beside the existing fixture-generation specs (core
  `__fixtures__` / wodal goldens pattern: write-if-missing + byte-stable). The
  C++-side dump/trace emitters (and the 6j input-script parser) tap a passive
  observer hook (no VM-semantics coupling) but are **host-test-only and MUST NOT
  be in the firmware build** - flash is a premium and the device never emits a
  trace/dump nor reads a script file. The firmware recursively globs
  `cpp/core/**/*.cpp` (`targets/microbit-v2/CMakeLists.txt`), so these
  host-only `.cpp` live **outside the firmware's `core/` glob** (a host-only
  source set only the host CMake compiles), leaving only the device-needed decode
  path (`program-reader`) and the header-only `VmObserver` interface in `core/`.
  Exclusion is **by construction (a directory boundary), not by `--gc-sections`
  dead-stripping**. Goldens are regenerated by the build path,
  never hand-edited. **Plumbing:** the C++ test tree locates the fixture roots
  (core `__fixtures__/`, wodal `__fixtures__/`) via stable relative paths wired
  in Phase 1a's CMake; one documented command runs the
  regen-goldens -> re-run-C++-suite loop; the TS write-if-missing +
  byte-stability specs are the staleness guard (a fixture and its committed
  dump regenerate together or fail).

## Cross-Phase Invariants

- **Parity is the correctness bar.** Every observable behavior of the C++ VM -
  opcode effects, value semantics, truthiness, scheduler ordering, fault codes,
  host-call argument layout - must match the TS reference VM for the same
  `.mcprogram` and input sequence. The TS VM is the oracle; disagreement is a C++
  bug unless the TS VM is demonstrably wrong (then fix the contract and both).
- **Single-entry VM rule.** Only the host loop may call `think()`,
  `scheduler.tick()`, `runFiber()`, or resolve/reject/cancel handles. ISRs, CODAL
  message-bus callbacks, and serial events enqueue only; the host loop drains,
  resolves, schedules, and executes. The "enqueue only" constraint is transitive
  (a CODAL `MessageBus::send` delivering inline must not re-enter the VM). An
  optional `inVm` re-entry guard may surface violations as a fatal fault.
- **Host calling convention.** Positional arg buffers; `argc` is the buffer
  width; `callSiteId` keys per-callsite host state; missing optional slots are
  `NIL_VALUE` with no separate presence map; sync host calls get an ephemeral
  stack view, async host calls get an owned snapshot plus a `HandleId` and must
  eventually resolve/reject/cancel it.
- **Compiler is target-unaware.** The same bytecode runs on TS and C++. No
  per-target lowering; no opcode gating. Host capability differences are
  expressed through host registration and the statically declared device ABI, never through
  VM-level flags or compiler target awareness. Numeric *results*, however, are a profile
  property (Locked Decision 6): the bytecode and compiler stay target-neutral, but
  numeric ops resolve to the profile's precision at registration, so cross-profile
  numeric identity is not guaranteed; TS and C++ for the same profile match.
- **C++ import-firewall (mirrors the TS runtime closure rule).** `cpp/core/` is a
  closed module: its files value-depend only on other `cpp/core/` files. The
  device firmware, CODAL host layer, and the desktop parity harness all depend on
  `cpp/core/`; `cpp/core/` depends on none of them. Within core, `runtime/` and
  `codec/` depend only on `platform/` and each other, mirroring the TS firewall.
  Default to a single portable native `platform/` implementation that compiles for
  both the desktop host and the device; introduce a platform-variant seam only if
  the device forces a divergent allocator or byte-array backing.
- **The shared contracts are fixture-tested bidirectionally.** The binary format:
  a committed binary fixture round-trips in TS and parses byte-identically in C++.
  The device ABI (core host-functions, target actions + native methods, field-id
  layouts, type-id atoms): the TS-registry-equals-C++-bindings parity tests
  (field-by-field; no `abiDigest` - permanently removed, see Locked Decision 8).
- **Caps are runtime upper bounds, not sizing inputs (Locked Decision 7).**
  `maxStackSize`, `maxFrameDepth`, `maxHandlers`, `maxHandles`, `maxFibers` -
  plus the managed-heap pool caps - are deterministic-fault guards checked at
  runtime (overflow -> `ErrorCode.StackOverflow`), identical to the TS VM;
  storage is allocated on demand from the region, never pre-sized to a cap. The
  per-fiber `FiberWorkspace` is the one tracked exception until Phase 6e.
- **Numeric model is a per-profile precision (Locked Decision 6).** Numbers are not
  universally f64. The precision is set by an indicator passed to core operator/
  conversion registration, which registers precision-appropriate implementations
  behind precision-agnostic operator ABI ids. **microbit-v2 = f32** (single number
  type; i32-coerced bitwise with results rounding to the profile precision). The
  TS reference models the profile's precision bit-
  exactly (`Math.fround` / `| 0` / `Math.imul`) so the oracle follows the hardware;
  the C++ device uses native ops (f32 on the M4F FPU). The number type is a build-
  time typedef (`mc_number_t`) selected by the profile's precision. Per-profile
  parity (TS-sim == C++-device for the same profile); cross-profile numeric
  identity is not guaranteed. f32 integer exactness caps at 2^24. Device-field
  widths are modeled separately at the host/device boundary
  (`packages/wodal/src/core/numeric.ts`).
- **Error model.** Faults carry a numeric, wire-stable `ErrorCode`
  (`Cancelled=2`, `HostError=3`, `ScriptError=4`, `StackOverflow=5`,
  `StackUnderflow=6`, `Timeout=1` reserved). No platform throw escapes `runFiber`.
- **No process-global mutable state.** VM/scheduler/runtime/device are instances.

## Reference Map (the semantics to mirror)

Concrete anchors:

- Opcodes (`BYTECODE_VERSION = 1`), fixed numeric assignments, 3-operand `Instr`
  (`a`,`b`,`c`). Includes `HOST_ACTION_CALL = 44` /
  `HOST_ACTION_CALL_ASYNC = 45` alongside the bytecode `ACTION_CALL = 42` /
  `ACTION_CALL_ASYNC = 43`. **Field access is by numeric field id**:
  - `STRUCT_GET_FIELD = 114 <fieldId>` / `STRUCT_SET_FIELD = 115 <fieldId>` are
    the **primary** field-access opcodes for all static (typed) access. Operand `a`
    is a numeric field id that is **also the storage slot**. Both route native
    structs through an **id-based** getter/setter (int dispatch), else read/write
    `struct.v[fieldId]`. `STRUCT_SET_FIELD` is a **pure store - no copy**.
  - `STRUCT_DEEP_COPY = 116` (operands `[]`): pop a value, push a deep copy (copies
    structs; no-op for lists/maps/primitives). The **brain** compiler emits it
    immediately before `STRUCT_SET_FIELD` to preserve struct value-semantics; the
    ts-compiler never emits it (JS reference semantics). The C++ VM implements both
    front-ends' output, so it must implement `STRUCT_DEEP_COPY` + pure-store
    `STRUCT_SET_FIELD`.
  - `GET_FIELD = 120` / `SET_FIELD = 121` are **retained as the name-keyed
    fallback** (operands `[]`, pop a string key): ts-compiler `struct[computedKey]`,
    static destructuring reads, generic non-struct writes, and the brain compiler's
    fallback when an access object's static type is not a concrete struct. They
    resolve `name -> fieldId` then delegate to the same id path; no native struct
    string-compares anymore. Never on the de-stringed device hot path.
  - `RESERVED_111` / `RESERVED_112` (formerly `STRUCT_GET`/`STRUCT_SET`, now
    producer-free) are **reserved enum placeholders** kept only to preserve opcode
    numbering; they have `OPERAND_SCHEMA: []` and **fault** (`ScriptError`, unknown
    opcode) if dispatched. The C++ decoder must round-trip them but the VM rejects
    execution.
  - `STRUCT_NEW = 110`: **construction is de-stringed** - operand `a` is
    **reserved-0** (the name/value-pair path is deleted; the VM faults on
    nonzero); statically-keyed construction lowers to `STRUCT_NEW` + per-field
    `STRUCT_GET_FIELD`/`STRUCT_SET_FIELD`. `STRUCT_COPY_EXCEPT = 113` survives
    only as the dynamic-computed-key fallback (name-keyed family, runtime data).
    Both carry a typeId operand `b` that is a **type-table index** (sentinel-
    biased optional), as does `INSTANCE_OF.a`.

  `bytecode.ts` `Op` enum is the canonical TS expression; `vm-contract.md` opcode
  reference is the contract.
- Value: tagged union on `NativeType` (`Unknown=-1`, `Void=0`, `Nil=1`,
  `Boolean=2`, `Number=3`, `String=4`, `Enum=5`, `List=6`, `Map=7`, `Struct=8`,
  `Function=11`) plus VM-internal `"handle"` and `"err"`; pooled singletons
  (`NIL_VALUE`, `VOID_VALUE`, `TRUE_VALUE`, `FALSE_VALUE`); containers back onto
  platform `List`/`Dict` (`value.ts`).
- Program (`program.ts`): `version`, `functions` (`FunctionBytecode`:
  `code`, `numParams`, `numLocals?`, `name?`, `maxStackDepth?`,
  `injectCtxTypeIdx?` - a numeric **type-table index**), the **per-program type
  table `types: List<ProgramTypeEntry>`** (tags
  atom/list/map/union/function/nullable/struct/enum; children strictly before
  parents; struct entries carry `name` + `maxFieldId`, enum entries carry `name` +
  ordinal-defining `symbols`; both linkers offset-merge tables and the tree-shaker
  marks/compacts/dedups them),
  three independent constant pools (`numbers`/`strings`/`values`), `variableNames`,
  `entryPoint?`, `actions?` - **`List<BytecodeExecutableAction>`, bytecode-only**
  (host actions dispatch by id, not via this table; empty for host-only programs),
  `ruleFuncIds?`, `ruleAncestors?`.
- `LinkedBrainProgram` (`host-bindings.ts`): `{ program, ruleIndex:
  Dict<string,number> (in-memory only, not serialized), pages: List<PageMetadata> }`.
  `PageMetadata`: `pageIndex`, `pageId`, `pageName`, `rootRuleFuncIds`,
  `actionCallSites: List<ActionCallSiteEntry>` (the page sensors/actuators fields
  were removed). `ActionCallSiteEntry` is a union: host `{callSiteId, actionId}` /
  bytecode `{callSiteId, actionSlot}`.
- Serialized form (`brain-program-codec.ts`): `LinkedBrainProgramJson = { program:
  BrainProgramJson, pages }` (no `ruleIndex` - hydrates empty). The JSON
  **bytecode-action entry is `{ entryFuncId,
  initializer/activation/deactivationFuncId? }`** - no `binding`, `key`, `isAsync`,
  or `numStateSlots` (lazy) - matching the binary entry (which var-int-packs it).
- Committed `.mcprogram` fixtures, one per action kind:
  `button-display.mcprogram` (host actions: `HOST_ACTION_CALL = 44` with `actionId`,
  empty `actions[]`, host `actionCallSites` `{callSiteId, actionId}`) and
  `user-tile-button-display.mcprogram` (bytecode actions: `ACTION_CALL = 42` by
  slot, `actions[] = [{entryFuncId}, ...]`, bytecode `actionCallSites`
  `{callSiteId, actionSlot}`). Both are the parity-suite seeds.
- **User-tile bytecode bodies reach the device via `HOST_CALL` + `STRUCT_GET_FIELD`,
  not host actions.** In `user-tile-button-display`, the
  action bodies do `LOAD_LOCAL ctx` -> `STRUCT_GET_FIELD <ctx.microbit fieldId>` ->
  `STRUCT_GET_FIELD <microbit.buttonA/display fieldId>` (a native struct projection
  **by numeric field id**, no string pool entries) then `HOST_CALL` the micro:bit-v2
  native struct methods (e.g. `Button.isPressed`, `display.setPixelValue`) plus core
  operators. The fixture's **CSTR is empty** (no field-access strings, no typeId
  strings). So
  real user tiles need, on the C++ side, the **target native host-function surface**
  (HOST_CALL methods), **id-based native-struct field dispatch** (an int switch /
  jump table per native struct, keyed by field id), and the type registry for the
  `ctx`/`microbit` structs - beyond the two host actions.
- Scheduler/think-loop: `FiberScheduler` + `BrainRuntime.thinkPage` ->
  `scheduler.tick()` -> per-fiber `runFiber` with instruction budget; fiber states
  `RUNNABLE`/`WAITING`/`DONE`/`FAULT`/`CANCELLED`; `HandleTable` for async
  (`vm.ts`, `vm-types.ts`, `brain-runtime.ts`).
- Host actions: declared as one object
  (`key`, `callDef`, `fn`, `isAsync`, `outputType`, `metadata`); registered into an
  id-keyed `BrainActionRegistry` (a required, statically declared id supplied via
  the module's `HostActionIds` record - core registers 8 host actions of its own at
  action ids 0-7; targets register at `>= TARGET_ACTION_ID_BASE`),
  **called by stable id via `HOST_ACTION_CALL` / `HOST_ACTION_CALL_ASYNC` and
  resolved with `getById`** (`getByKey` remains for compile-time resolution);
  per-callsite host state via
  `services.brain.callsite.{getHostState,setHostState,clearHostState}`. The two
  microbit-v2 actions: `microbit-v2.button-a` (sensor, Boolean, sync, optional
  pressed/released modifier, edge-detected via callsite state) and
  `microbit-v2.display-set-pixel` (actuator, sync, optional x/y/brightness,
  defaults 0/0/255).
- Stream primitives: little-endian, currently fixed-width with self-describing
  type-tagged values and versioned chunks; node uses `Uint8Array`/`DataView`, rbx
  uses Luau `buffer`; shared length caps (`kMaxStringLength=512`,
  `kMaxLongStringLength=64KB`, `kMaxByteArrayLength=1MB`). The **raw var-int
  (LEB128)** primitives carry all integer quantities in a **codec-local
  flat frame** (the binary codec does not use the `stream.ts` tagged-chunk
  mechanism); the rbx variant may stub them (binary serde is unused on Roblox).

---

## Prep A: Binary `.mcprogram` Codec (TS)

**Status: COMPLETE - format version 2.** Shipped as `brain-program-binary-codec.ts`
(+ its spec test) in core; the code is authoritative. The LOCKED blocks below are
the wire-format spec the C++ reader (Phase 2) mirrors. Version 2 (the typeId
de-stringing revision) adds the `TYPS` type-table section and removes every typeId
string from the wire. **Codec API:** both entry points take an `ITypeRegistry` -
required by the decoder (atoms and atom-enum symbols resolve through it), optional
for the encoder (atom-enum ordinals only).

Wire format - framing (LOCKED):

- **Codec-local framing (not the generic stream chunk mechanism).** The file is a
  **4-byte magic** (`0x89` + `"MBP"`; the high-bit lead byte distinguishes a binary
  `.mcprogram` from JSON text and catches 7-bit/text-mode corruption as in PNG, and
  `MBP` identifies the format in a hex dump), a **1-byte format version** (raw u8,
  currently 2), the
  **profileId** (var-uint = the device profile's numeric id), a **1-byte presence
  bitmask** for the optional sections, then the **section bodies** in fixed
  positional order. A per-section chunk frame (`DataType.Chunk` + u32
  tag + u32 version + u32 length, 13 bytes each) was rejected: header overhead
  dominates small images.
- **Var-int scheme (LOCKED):** unsigned = **ULEB128** (`writeVarUint`/`readVarUint`);
  signed = **zigzag + ULEB128** (`writeVarInt`/`readVarInt`). All quantities are
  <= 32-bit, so the **max encoded length is 5 bytes**; a 6th continuation byte (or
  any value exceeding 32 bits) is a **decode error** (stable diagnostic, no silent
  truncation). ULEB128 is inherently little-endian-7-bit, so no endianness
  ambiguity. (rbx excluded - binary serde unused on Roblox.)
- **Positional sections, fixed order, no tags or lengths.** Each section is
  self-delimiting by its leading count, and the reader knows the order, so no tags
  or length prefixes are written. Order: **`CSTR` first** (the string table; every
  later section resolves string indices against it), then **`TYPS`** (the program
  type table; typeId references in later sections are TYPS indices), `CNUM`
  (numbers pool),
  `CVAL` (values residual pool), `FUNC` (functions), `VARS` (variableNames), the
  present optional sections `ACTS` (bytecode actions), `RULF` (ruleFuncIds), `RANC`
  (ruleAncestors), and finally `PAGE` (pages incl. actionCallSites). No
  `entryPoint` (dropped - see payload).
- **Optional sections** = `ACTS`/`RULF`/`RANC`, gated by the presence bitmask
  (bit0 `ACTS`, bit1 `RULF`, bit2 `RANC`). A set bit means the field is present
  (possibly empty); a clear bit hydrates `undefined`. The required sections
  (`CSTR`, `CNUM`, `CVAL`, `FUNC`, `VARS`, `PAGE`) are always written.
- **Versions:** a single **envelope format version** byte gates the whole layout
  (currently **2** - the type-table revision; bump on any layout change). Reader
  policy: **reject any format version != 2** with a stable diagnostic - there is
  **no legacy reader and no back-compat codepath** (pre-release; fixtures are
  regenerated, never migrated). There are no per-section versions and no
  skip-unknown reads -
  adding or changing a section is a format-version bump, not a tolerated extension.
  The **format-version axis** (this codec version + 5a's on-flash `formatVersion`)
  is checked at load. There is **no** device-ABI version/`abiDigest` axis -
  permanently removed (see Locked Decision 8).
Wire format - instruction operand encoding (LOCKED):

- Operands are always a contiguous prefix of `a,b,c` (no opcode uses `c` without
  `b` or `b` without `a`), so per-instruction encoding is **schema-driven, no
  per-operand tag**: each instruction is `op` (a **raw u8** - 1 byte; not a var-int,
  since op values run to 171 and a var-uint would be 2 bytes for most) followed by
  its operands per a per-opcode **operand schema**.
- The **operand schema** is the single source of truth, keyed by opcode, derived
  from the contract's operand columns; it lives in `bytecode.ts` next to the `Op`
  enum (the TS codec uses it directly; the C++ reader hand-mirrors it, guarded by
  the every-opcode round-trip test). Each opcode maps to an ordered operand list; each entry is `uvar`
  (unsigned ULEB128) or `svar` (zigzag), with an `optional` flag allowed only on the
  trailing entry.
- Signedness (`svar`): exactly the 5 rel-offset opcodes - `JMP`, `JMP_IF_FALSE`,
  `JMP_IF_TRUE`, `WHEN_END`, `TRY` (their `a`); every other operand is `uvar`.
- Optional trailing operand: the 4 constructors `LIST_NEW`, `MAP_NEW`, `STRUCT_NEW`,
  `STRUCT_COPY_EXCEPT` have an optional `b` (a **type-table index**),
  **sentinel-biased**: write `b+1`, `0` = absent. (`STRUCT_NEW.a` is reserved-0 -
  see Reference Map.)
- Safeguards (a wrong schema entry silently misaligns the stream): the **encoder
  validates each `Instr`'s defined operands against the schema** and throws on
  mismatch (drift -> serialize-time error); and an **every-opcode round-trip test**
  (one instruction per opcode, incl. signed and optional-`b` cases) is a gate.
- Adding a raw-u8 primitive (for `op`) alongside the raw var-int primitives is part
  of the stream extension.

Wire format - numbers pool (CNUM) encoding (LOCKED):

- Numbers are stored **at the target profile's precision** (the `.mcprogram` is
  profile-tagged) - **f64 is never sent to an f32 target**. Per CNUM entry: a 1-byte
  discriminant + payload. Discriminants: `0` small-int (zigzag var-int), `1` f32
  (4 bytes), `2` f64 (8 bytes).
- The serializer is given the profile precision and **rounds each literal to it
  first** (`Math.fround` for f32; identity for f64), then encodes the rounded value:
  finite integer in i32 range and not `-0` -> small-int (`0`); else the profile's
  float - f32 (`1`) for an f32 profile, f64 (`2`) for an f64 profile. An f32 build
  therefore emits only `0`/`1`; an f64 build emits `0`/`2` (and may use `1` for
  f32-exact values as a lossless size win). Edge cases land on the profile float:
  `-0` and `NaN` are not small-int-encodable.
- Enforcement: an **f32 device decoder rejects discriminant `2` (f64)** with a
  stable diagnostic - so f64 cannot reach an f32 target even via a mis-built program.
- Because build-time rounding is the same rounding the runtime would apply, and the
  pool holds authored literals (the compiler does no numeric constant folding -
  verified), constants are exact for the profile and need no runtime rounding at
  `PUSH_CONST_NUM` (operator *results* still round per Locked Decision 6). Re-verify
  the no-folding assumption if compiler constant-folding is ever added.
- The same precision rule applies to **numbers nested in the value pool** (CVAL),
  via the value codec below.

Wire format - value codec (CVAL) encoding (LOCKED):

- The CVAL body is `count (var-uint) + N values`; `PUSH_CONST_VAL a` indexes it.
  Each value is recursive: a **1-byte tag = `NativeType`** (mirrors the JSON `.t`
  and the runtime `Value` tag: `Unknown=-1`, `Void=0` ... `Function=11`) + a
  tag-specific payload:
  - `Unknown`/`Void`/`Nil`: nullary (tag only).
  - `Boolean`: 1 byte (0/1).
  - `Number`: the CNUM number encoding (profile-rounded discriminant; inherits
    *no-f64-to-f32*).
  - `String`: a **CSTR index** (var-uint).
  - `Enum`: `(typeIdx, ordinal)` var-uint pair (typeIdx -> TYPS; the ordinal is
    defined by the enum's symbol order).
  - `List`: typeIdx (TYPS index) + count (var-uint) + N values (recursive).
  - `Map`: typeIdx (TYPS index) + count (var-uint) + N entries, each `key-tag (u8:
    0=number, 1=string) + key (number encoding | CSTR index) + value (recursive)`,
    written in **insertion order**.
  - `Struct`: typeIdx (TYPS index) + field-count (var-uint) + fields (recursive) -
    **closed only**.
  - `Function`: funcId (var-uint) + **biased captures count** (`0`=undefined,
    `k+1`=k captures) + captures (recursive).
- **TypeIds and enum symbols are never strings in CVAL** (typeIdx -> TYPS; symbol
  -> ordinal). The remaining strings (`String` values, map string keys) are CSTR
  indices, deduped program-wide; the reader reads CSTR (and TYPS) before CVAL
  (canonical order).
- **`handle`, `err`, and native-backed structs are never encoded** - runtime-only
  values, never constants; the encoder throws (internal-error guard) if it sees one.
  (`Any`/`Union` are type tags, not values, so they don't appear either.)
- Gate addition: an **every-variant value round-trip test** (nested List/Map/Struct,
  Map with both key kinds, Function with/without captures, Enum) - the committed
  fixtures only carry a trivial `Nil`, so the container paths need explicit
  coverage.

Wire format - FUNC-section framing (LOCKED):

- FUNC body: `funcCount (var-uint)` then, per function: `numParams (var-uint)`,
  `extraLocals (var-uint)`, `injectCtxId (var-uint)`, `instrCount (var-uint)`, then
  `instrCount` instructions (op u8 + operands per the instruction schema above).
- `numLocals` is encoded as `extraLocals = numLocals - numParams` (always >= 0; `0`
  = no extra / default). Decode: `numLocals = numParams + extraLocals`. This
  normalizes an absent `numLocals` to `numParams` (semantically identical).
- `injectCtxTypeIdx` (renamed from `injectCtxTypeId`, now numeric) is a **biased
  TYPS index** (`0` = absent, `idx+1` = present).
- `instrCount` delimits the per-function instruction list (decoder reads exactly N
  self-delimiting instructions).
- **`name` and `maxStackDepth` are dropped** (lean payload; in-memory only).

Wire format - remaining section bodies (LOCKED):

- **CSTR (strings pool):** `total (var-uint) + constStringCount N (var-uint)` then
  `total` strings, each `byteLen (var-uint) + byteLen UTF-8 bytes`. The **first N
  entries are `constantPools.strings`** (opcode string operands index
  `0..N-1`, unchanged); the remaining `total - N` are **appended aux strings**
  (`pageId`, `variableNames`, value `String`s, and the TYPS program-local type
  names + enum symbols - **no typeId strings**: those left the wire in format
  v2), interned and deduped into the same table - an aux string equal
  to an existing entry reuses its index (including a pool index `< N`); a new aux
  string is **appended at `>= N`** (never prepended, so pool indices are preserved).
  All string references index the single `[0, total)` space; opcode operands only
  ever land in `[0, N)`. **Decode:** `constantPools.strings = strings[0..N)` (exact
  round-trip); aux fields read their stored index; appended entries `[N, total)`
  are NOT added to `constantPools.strings`.
- **TYPS (program type table):** `count (var-uint)` + `count` entries, children
  strictly before parents. Each entry is a **tag byte** + var-uint fields:
  `0` atom (atomId), `1` list (elem idx), `2` map (key idx + value idx),
  `3` union (member count + member idxs), `4` function (param count + param idxs +
  result idx), `5` nullable (base idx), `6` struct (name CSTR idx + slot count =
  `maxFieldId + 1`), `7` enum (name CSTR idx + symbol count + symbol CSTR idxs;
  list order defines the ordinals). Atom entries resolve through the statically
  declared atom ids. **Decoder note:** the TS decoder resolves atoms via the live
  `ITypeRegistry` (not a compiled-in map) and tracks per-entry
  `(typeId, name, coreType)` during string reconstruction, because nullable
  composition keys off the base entry's *name*, not its typeId. The C++ reader
  does neither: it interns entries to local handles against the compiled-in atom
  mirror and never reconstructs strings.
- **VARS (variableNames):** `count (var-uint)` + `count` CSTR indices (var-uint).
  The name strings live in CSTR. (**Both the count and the names are
  runtime-required**: the count sizes the variable slot space
  (`LOAD/STORE_VAR_SLOT` index it), and the name->slot map backs
  `BrainContext.getVariable`/`setVariable` and hot-swap value preservation by
  name. A count-only drop was evaluated and rejected.)
- **RULF (ruleFuncIds):** `count (var-uint)` + `count` funcIds (var-uint).
- **RANC (ruleAncestors):** `count (var-uint)` + `count` pairs
  `(funcId var-uint, parentFuncId var-uint)`.
- **PAGE (pages):** `count (var-uint)` then per page: `pageIndex (var-uint)`,
  `pageId (CSTR index, var-uint)`, `rootRuleFuncIds (count var-uint + var-uint
  funcIds)`, and `actionCallSites (count var-uint + per entry: binding-tag u8
  [0=host, 1=bytecode] + callSiteId var-uint + id var-uint [host: actionId;
  bytecode: actionSlot])`. **`pageName` is dropped** (debug-only, like function
  names; hydrates empty). (`pageId` is **runtime-live** - page tiles emit pageId
  strings and `SwitchPage` resolves through `pageIdToIndex` - so it stays; a drop
  was evaluated and rejected.)
- **Codec diagnostics:** a stable error-code family for decode failures -
  truncated/malformed buffer, bad magic, var-int overflow (> 32 bits), format
  version > reader max, invalid number discriminant / value tag, and
  **f64-numeric-entry on an f32 target** - per the repo's stable-code convention.

With this, every Prep A section body is specified: the wire format is complete.

---

## Prep B: Device ABI (statically assigned ids, declared in source) - COMPLETE (TS side)

Every device-ABI identity is a statically declared numeric id - no manifest, no
codegen, no registration-order counter; the C++ side is hand-maintained mirrors
guarded by **field-by-field parity tests** (no `abiVersion`/`abiDigest` - Locked
Decision 8). The full model + reserved-range partitioning is Locked Decision 2; the
authoritative enums live in the code (`core/runtime/abi-ids.ts`, wodal `tile-ids.ts`,
`apps/sim/abi-ids.ts`).

**Five id spaces**, partitioned core `[0, base)` / target `[base, ...)` (constants in
`core/runtime/abi-ids.ts`: `TARGET_FUNC_ID_BASE = 1024`, `DYNAMIC_FUNC_ID_BASE =
65536`, `TARGET_ACTION_ID_BASE = 1024`, `TARGET_TYPE_ATOM_BASE = 1024`):

1. Core host-function ABI (`HOST_CALL` by funcId; `CoreFuncId` 96 members, 0-95).
2. Target host-function ABI (microbit native struct methods, also `HOST_CALL`;
   `MicroBitV2HostFuncId` >= 1024) - shares the funcId space with (1).
3. Host-action ABI (`HOST_ACTION_CALL` by actionId; `CoreHostActions` 0-7;
   `MicroBitV2HostActions` ButtonA = 1024, DisplaySetPixel = 1025).
4. Native-struct field-id layouts (`STRUCT_GET/SET_FIELD <fieldId>` = storage slot /
   native int-switch; `Context` fields 0-5 + `microbit` = 6).
5. Nominal type-id atoms (`CoreTypeAtomId` 0-11 incl. `AnyList` = 7;
   `MicroBitV2TypeAtomId` 1024-1027) - structural/program-local types ride the
   per-program `TYPS` table instead.

Device dispatch stays dense (two arrays per partitioned space: core indexed by `id`,
target by `id - base`); ids are dense non-negative integers (an array index, not a VM
`Number` - profile precision N/A). Append-only: an id is never changed/reused (a
signature change retires + re-adds under a new id). The C++ mirror enums + binding
tables landed with their owning phases (2b/3/4); the field-by-field parity test is the
sole, sufficient drift guard. Background plans (all complete): host-actions-by-stable-id,
numeric-field-access, typeid-destring.

---

## Prep C: The microbit-v2 TS Oracle (TS-side core change) - COMPLETE

The TS reference computes what Locked Decision 6 promises for microbit-v2, so Phase 3
has its oracle. As landed:

- **`ProfileNumerics`** (`runtime/profile-numerics.ts`): `round`, transcendental
  slots, `formatNumber`, `parseNumber`; `createProfileNumerics(precision)`, injected
  via `AppServices.numerics` (the `services.app.rng` precedent) and captured by
  operator/conversion/builtin exec bodies at registration (no ambient "active"
  object; f32 + f64 coexist in-process). Platform `MathOps` stays profile-invariant
  (VM internals must not vary). f32 models the M4F bit-exactly: `fround(f64 op)` is
  the correctly-rounded f32 for `+ - * / sqrt`; bitwise coerces via `|0` / `Math.imul`
  with the **stored result rounding to profile precision** (ratified; the C++ bodies
  in 6c match); NaN/div0/mod0 -> nil. **f32 transcendentals/formatter/parser are
  interim** (delegate-to-f64 + fround) until **Phase 6d** pins them.
- **Round-based scheduler**: `tick()` snapshots the runnable queue at entry; each
  snapshot fiber gets one `defaultBudget` slice; spawns / `YIELD` / budget re-enqueues
  / handle resumes join the next round; `maxFibersPerTick` deleted; `maxFibers` faults
  loudly at spawn. `SchedulerConfig` carries `defaultBudget` (microbit-v2 = 1000) +
  `hookBudget` (10000); both are profile-pinned and mirrored as C++ build constants.
- **Profile wiring**: microbit-v2 declares `numberPrecision: "f32"` + the budgets;
  `createMicroBitV2Environment()` is the single f32 wiring point; `apps/sim` keeps f64.
  `vm-contract.md` gained the numeric-semantics + fiber-scheduling sections.
- **Known seam (accepted):** the wodal in-process path loads JSON-hydrated programs
  whose constant pools are NOT profile-rounded (only the binary codec rounds), so
  in-sim an f64 literal can enter f32 arithmetic. The parity harness uses binary
  fixtures and is unaffected.

**6d note (pinned numerics - DONE, accepted 2026-06-14):** the interim f32 slots are
now pinned. Transcendentals = a stepwise-frounded op-sequence (per-op `Math.fround` in
TS / native `float` with `-ffp-contract=off` in C++; no `libm`, no `double`; bits agree
by construction) ported from Cephes single-precision; `formatNumber` = Ryu f2d +
`String(Number)` grammar; `parseNumber` = `fround(parseFloat)` (C++ integer strtod). See
the Phase 6d section.

---

## Phase 1: C++ Skeleton And Toolchain (1a-1c) - ACCEPTED 2026-06-12

Stood up `cpp/` with two build trees - the host-portable `core/` (desktop CMake, for
parity CI) and the `microbit-v2-samples` device build - plus the host test harness.
Structure is in Ownership Boundaries + Multi-Target Structure; the import-firewall and
no-process-global-state invariants are in Cross-Phase Invariants + Locked Decision 3;
toolchain pins live in `codal.json` + git history.

**Live C++ foundations (these bind every later C++ phase):**

- Layout: `core/` (target-neutral: `platform/`, `runtime/`, `codec/` - no
  CODAL/microbit dependency), `codal/` (board-agnostic CODAL bridge + the device-port
  interface), `targets/microbit-v2/` (board specifics + the `abi/` mirror enums +
  binding table), `test/` (host parity/unit), `tools/`.
- **Exceptions + RTTI OFF in `core`** (`-fno-exceptions -fno-rtti`); errors are a
  `Result`/status idiom + the numeric `ErrorCode`. **C++17** for all our C++, applied
  **per-source** in the device build (CODAL pins `-std=c++11`; gcc last-flag-wins, so
  add any new device C++ glob - e.g. `cpp/codal/` - to the per-source C++17 list).
  **No STL containers in `core`** (`std::string`/`vector`/`map`/iostreams forbidden -
  value types are bespoke per the Heap model; `<cstdint>`/`<cstring>`/`std::array`/
  spans are fine). `-Wall -Wextra -Werror`.
- Tooling: doctest (vendored; the `test/` tree builds with exceptions for its own
  asserts only and links the no-exceptions core); `.clang-format`; the `cpp/check.sh`
  suite (build + tests + ASan/UBSan + format) is "CI" (hosted CI deferred); the
  `check-deps.sh` layering guardrail (core <- codal <- target). Pins: codal v0.3.4,
  Docker gcc 10.3; C++17 proven on-device.

---

## Phase 2: Binary Reader In C++ (2a-2c) - ACCEPTED 2026-06-12 (PHASE 2 COMPLETE)

The C++ reader for the binary `.mcprogram` (format v2): all five committed fixtures
decode to the same structure the TS codec produced, witnessed by a canonical-dump
byte-compare. Landed: `core/platform/` `ByteCursor` (var-int - ULEB128 / zigzag / raw
u8, max-5-byte/32-bit overflow rule), `LoadError` + `Result<T,E>`, the decoded program
image (`program.h`), the canonical dump emitter (the gate mechanism), and all the Prep
B ABI mirror headers. The wire format it mirrors is in Prep A (+ the codec code); the
decoded-image and type-table shapes are in `program.h` + Value Layout.

**Live invariants this phase locked:**

- **Wire-buffer access (locked):** never reinterpret-cast into the `.mcprogram` byte
  buffer - read multi-byte payloads (f32 etc.) byte-wise / `memcpy` into locals
  (Cortex-M4 faults on unaligned FP loads; casting unaligned bytes is UB). The wire is
  var-int-compact with **no padding**; the decoder lays out pools + instruction arrays
  with natural alignment, so hot-path loads are aligned; borrowed const strings are
  byte data, alignment-free.
- Decoded image = a single **contiguous read-only** structure (indices, not pointers)
  so it can live in flash for the 5a boot path; strings are **borrowed** from the wire
  buffer (which must outlive the image).
- Ratified, do not re-raise: the reader is **f32-fixed** (no precision option until an
  f64 target exists); three strictness deviations vs the TS decoder stand (C++ rejects
  what TS silently accepts; the encoder never emits them); no CVAL recursion-depth cap
  (see Deferred Work).

---

## Phase 3: Value Model And Core Interpreter (button-display subset; 3a-3c) - ACCEPTED 2026-06-12 (PHASE 3 COMPLETE)

The C++ value model + fiber scheduler + dispatch loop for the `button-display` opcode
subset, byte-matching the TS oracle on the host harness (the parity gate passed on the
first run). The `Value` representation is in Value Layout; the observable-trace format
v1 lives in wodal `observable-trace.ts` (+ Parity Surface); round-based scheduling is
Prep C.

**Live facts this phase locked:**

- **Locals live in a separate shared region**, not interleaved with the operand stack
  (interleaving would shift `StackUnderflow` timing vs the oracle).
- The fiber operand stack is **shared, not per-fiber-fixed** (per-fiber-fixed would
  cost `sizeof(Value) x maxStackSize x maxFibers` - LD7); the fiber<->stack interface
  is pinned (base/limit; suspension preserves the live range); the grow-on-demand
  stack arena is Phase 6e.
- **Round-based ticks** (Prep C): snapshot at entry; spawns / re-enqueues / resumes
  join the next round; respawn completed AND faulted rule fibers next think (a fault
  kills the fiber, not the rule). The **dt rule** (dt = 0 while `lastThinkTime == 0`,
  else the delta) is load-bearing and mirrored exactly.
- `HOST_ACTION_CALL` (44) dispatches via the Prep B binding-table skeleton (by-id
  lookup; unregistered ids fault the existence-check path); the action bodies are exact
  wodal ports in `targets/microbit-v2/abi/host-action-bindings.h`.
- Ratified seams, do not re-raise: flag-bit string reservation; typeId = direct TYPS
  index; the f32 display-port narrowing lives in the C++ action body (the
  port-typing seam, resolved in 6j to match CODAL - i16 coords, u8 brightness, device
  early-out; see Deferred Work); `RunStatus::Waiting` faults
  `HostError` through the observer (unproduced until async, 6h); `sweep()` LIFO reclaim
  is parity-invisible. Caps (`kMaxStackSize`/`LocalsSize`/`FrameDepth`/`Handlers`/
  `Handles`) are runtime guards, never pre-sizing (LD7).

---

## Phase 4: Micro:bit v2 Host Layer (CODAL) (4a-4b) - ACCEPTED 2026-06-13 (PHASE 4 COMPLETE; runs on real hardware)

Bound the C++ VM to real CODAL devices - the device-port impls + the on-device host
loop - so button A toggles a display pixel on hardware, matching the sim. 4a (the
board-agnostic `cpp/codal/` runtime layer, CI-gated) then 4b (the micro:bit v2 board
binding + on-device run, hardware-gated). The Phase 3 action bodies were re-bound
unchanged against CODAL ports.

**Live facts this phase locked:**

- **Device-port interface** (`cpp/codal/device-port.h`, pinned at 4a):
  `PixelDisplayPort` (u8), `ButtonInputPort` (level poll), `MonotonicClockPort`,
  `FaultDisplayPort`. The host loop is the **sole `think()` entry** (enqueue-only; no
  CODAL callback re-enters - Cross-Phase Invariants).
- **Cadence (4b lock):** a fixed sleep loop (`HostLoop.tick()` + `uBit.sleep(16ms)`),
  NOT a `system_timer` callback - keeps single-entry; real time is sampled from the
  clock port each tick so the dt rule survives loop jitter.
- **Device fault mode:** on an unrecoverable condition (decode/load failure, cap
  exhaustion, native assert) the runtime stops ticking and loops "sad face + scroll
  the stable error code" (full detail once over serial). Policy is board-agnostic
  (4a); rendering is `FaultDisplayPort` (4b). Per-fiber script faults are NOT fault
  mode (the fiber dies, the rule respawns - parity-identical to the sim). The R/L/E
  fault domains (5a/boot) build on this.
- The CODAL region finding (`device_malloc` panics on OOM, so the VM region is a
  static `.bss` partition, not a heap claim) is reconciled into Locked Decision 7.

---

## Phase 5a: Firmware Flash Foundation + Shared On-Flash Contracts (cpp) - ACCEPTED 2026-06-13

Board-neutral on-flash region (`cpp/codal/on-flash-region.{h,cpp}`) + boot read-path
(`main.cpp`: decode from memory-mapped flash, strings borrowed zero-copy; only the
decoded image lands in the 32 KiB RAM arena) + the dual-artifact build
(`MICROBIT.hex` + `MICROBIT.metadata.json`). The 4b embedded-program scaffolding was
retired grep-clean. Host-gated.

**Contracts (consumed by 5b/5c + the 6b follow-up):**

- **On-flash header (LOCKED):** magic `"MCFR"` (4d 43 46 52) + `formatVersion` = 1,
  then the `.mcprogram` payload to end of region. No checksum/length/ABI fields (the
  2c reader faults on corruption; the program is self-delimiting; ABI machinery is
  permanently removed - Locked Decision 8). `RegionError` = `NoProgram` /
  `InvalidMagic` / `UnsupportedFormatVersion` (`R1`/`R2`/`R3`), via
  `FaultDomain::Region`.
- **Metadata** (`firmware-metadata.ts`, types + constants): `{ schemaVersion,
  regionOffset, regionSize, regionMagic, onFlashFormatVersion }`, emitted by
  `tools/emit-metadata.py` from the linked ELF symbols.
- **Region placement (dynamic):** start = the firmware's flash end, page-aligned
  (`__mcprogram_region_start = ALIGN(__etext + SIZEOF(.data), 0x1000)` in
  `mcprogram-region.ld`), end = `0x73000` (CODAL carves `0x73000..0x77000`), so
  `regionSize` tracks firmware size (current build `0x39000` +~237 KiB);
  `ASSERT(start + 0x1000 <= end)`. The address lives once in the `.ld`; firmware reads
  it via the linker symbol, the build re-extracts it from the ELF. Consequence: a
  patched hex is valid only for the exact firmware build it was patched against.

---

## Phase 5b: Hex Patcher (wodal core + CLI) (TS, host/CI-gated) - ACCEPTED 2026-06-13 (hardware-validated)

A target-neutral byte patcher + `wodal` CLI, all flash code in the neutral
`packages/wodal/src/mindcraft/` layer (the Intel HEX + on-flash formats are
board-neutral): `firmware-patcher.ts` (`patchFirmwareHex({firmwareHex, metadata,
program})` - bounds-check the fit, write the 5-byte `MCFR` header + program at
`regionOffset`, splice; sole failure `program-too-large`; no ABI/identity check -
Locked Decision 8), `intel-hex.ts` (in-repo writer: type-00 16-byte records + type-04
ELA records re-emitted on each 64 KiB crossing; deterministic), `program-image-binary.ts`
(`wodalProgramBytes` - JSON or binary `.mcprogram`), `environment.ts`
(`createWodalEnvironment`), and the relocated `firmware-metadata.ts` (moved here from
`src/targets/microbit-v2/mindcraft/`). CLI `src/cli/wodal.ts` (`wodal patch ...`) is an
esbuild-bundled self-contained Node bin. Gate: deterministic hex; oversize rejected;
patched bytes match the input at `regionOffset`; hardware: the CLI-built
`button-display.hex` drag-dropped toggles the pixel.

---

## Phase 5c: microbit-sim Deploy - Download and WebUSB Flash (TS/web) - ACCEPTED 2026-06-14 (both gates hardware-validated; THE DEPLOY ARC IS COMPLETE)

The browser integration of 5b's core, as per-brain links in `BrainList`: a **Download**
link (build patched hex -> Blob, always shown; the non-WebUSB fallback) and, after a
one-time **Connect micro:bit** pairing, a per-brain **Flash** link (direct WebUSB
write). Reuses 5b's `patchFirmwareHex` + `wodalProgramBytes` unchanged. Files in
`apps/microbit-sim`: `firmware-deploy.ts`, `firmware-asset.ts`, `microbit-flasher.ts`,
`BrainList.tsx`, `scripts/vendor-firmware.mjs`.

**Locked decisions:** WebUSB via **`@microbit/microbit-connection`** (wraps dapjs) with
**partial flashing** (changed pages only, SoftDevice intact). **Hardware finding (keep
for any future V2 flashing):** raw dapjs `DAPLink.flash(binary-from-0)` corrupts
micro:bit V2 boot (rewrites the SoftDevice/MBR; symptom = no `mc boot` on the USB-CDC
serial at 115200) - use partial flashing. A brain authored in microbit-sim now reaches
a real micro:bit v2 by download or WebUSB; user-tile brains patch + flash but run inert
until 6f.

---

## Phase 6: Full Conformance (split: 6a-6j) - ACCEPTED 2026-06-17 (PHASE 6 COMPLETE; fully conforming C++ VM)

Goal: Bring the C++ VM to full VM-contract conformance (every opcode), implement
bytecode (user-tile) action execution, and stand up a golden parity suite that runs
a representative program set through both the TS VM and the host-portable C++ VM,
asserting matching behavior. **On the critical path to a usable microbit-v2, not
optional polish**: microbit-v2 brains contain user tiles whose arbitrary bytecode
needs (near-)full opcode coverage plus the bytecode-action machinery.

Split into **nine** sub-phases along natural seams - each a discrete,
independently-gated deliverable, none overweight:

- **6a - Managed heap + value containers:** the GC + lists/maps.
- **6b - Structs + closures:** id-based structs + the deep-copy model + closures.
- **6c - Core host-function library (f32):** the ~96 `CoreFuncId` bodies + RNG +
  dynamic (managed) strings with their producers.
- **6d - Pinned numerics:** bit-exact transcendentals + f32 formatter + parseFloat.
- **6e - Exceptions, yield + the grow-on-demand stack arena:** try/throw/yield; the
  `FiberWorkspace` worst-case block removed (the last Locked Decision 7 reservation).
- **6f - Bytecode actions + the user-tile surface (split 6f1/6f2/6f3/6f4):** the
  milestone - `user-tile-button-display` runs on real hardware. **6f1** = struct
  re-string (v3) + type-registry foundation; **6f2** = bytecode-action execution model
  (`ACTION_CALL` + callsite + page lifecycle + `assertCanSuspend`); **6f3** =
  context-variable host fns (`ctx.brain`/`ctx.rule` `getVariable`/`setVariable`, 48-51);
  **6f4** = native device surface, reaching the on-hardware run; **6f5** = core
  sensor/actuator host actions (page-switch/timeout/random/page-sensors - added after a
  timer brain faulted on device).
- **6g - Cap parameterization (topology parity with TS):** the C++ scheduler sources
  its caps from the device profile (by `profileId`) through a runtime config seam, as
  the TS reference does, replacing the global `constexpr`; folds in the cap-parity
  guard. Lands before 6i's `kMaxHandles` raise.
- **6h - Async core:** the generic handles/await/WAITING-resume machinery + the
  three async opcodes; host-gated. **On the microbit-v2 critical path** - scroll (6i)
  is a real async capability.
- **6i - Display scroll-text (the first async capability):** an *async*
  `display.scroll(text)` mirroring CODAL's cooperative blocking scroll; the async
  core's on-hardware parity gate. microbit-v2 gains a handle budget here.
- **6j - Conformance + parity suite:** full golden set green, instruction-trace
  mode, opcode-completeness check.

Dependencies: 6a underlies all; 6b needs 6a; 6d needs 6c; 6e needs the 3b
fiber/stack model; 6f1 needs 6b + 6c; 6f2 needs 6b + 6e; 6f3 needs 6b + 6e + 6f2
(extends its `ACTION_CALL` entry for action-frame rule inheritance); 6f4 needs 6f1 + 6f2
(6f3 lands first for stateful brains); 6f5 needs the 3c scheduler + 6f2's callsite/page
machinery (independent of 6f1/6f3/6f4; sequenced before 6g); 6g needs the 3c
scheduler (independent of the 6f arc; lands before 6i's `kMaxHandles` raise); 6h needs
6e + 6f2; 6i needs 6h (+ 6c for the computed-string variant); 6j needs all. **The
microbit-v2 critical path is 6a -> 6b -> 6c -> 6f1 -> 6f2 -> 6f3 -> 6f4** for user-tile
brains,
**plus 6h -> 6i for the scroll capability** (an async host action, so async is on the
path now, not conformance-only) and 6d for numeric parity.

**Opcode coverage (every `Op` has a home).** A one-time audit (2026-06-14) assigning
each opcode to the phase that implements it - 6j's conformance check is the backstop,
but no opcode is left orphaned. "Done" = live in the Phase 1-3 slice (`vm.cpp`).

| Phase | Opcodes |
| --- | --- |
| Done (1-3) | `PUSH_CONST_VAL`0 `POP`1 `DUP`2 `SWAP`3 `PUSH_CONST_NUM`4 `PUSH_CONST_STR`5 `STACK_SET_REL`6 `LOAD_VAR_SLOT`10 `STORE_VAR_SLOT`11 `JMP`20 `JMP_IF_FALSE`21 `JMP_IF_TRUE`22 `RET`31 `HOST_ACTION_CALL`44 `WHEN_START`70 `WHEN_END`71 `DO_START`72 `DO_END`73 `LOAD_LOCAL`130 `STORE_LOCAL`131 |
| 6a | `LIST_*`90-99 `MAP_*`100-104 `TYPE_CHECK`150 |
| 6b | `CALL`30 `STRUCT_NEW`110 `STRUCT_COPY_EXCEPT`113 `STRUCT_GET_FIELD`114 `STRUCT_SET_FIELD`115 `STRUCT_DEEP_COPY`116 `GET_FIELD`120 `SET_FIELD`121 `INSTANCE_OF`151 `CALL_INDIRECT`160 `CALL_INDIRECT_ARGS`161 `MAKE_CLOSURE`170 `LOAD_CAPTURE`171 |
| 6c | `HOST_CALL`40 (the opcode dispatch + the ~96 `CoreFuncId` bodies) |
| 6e | `YIELD`51 `TRY`60 `END_TRY`61 `THROW`62 |
| 6f2 | `ACTION_CALL`42 `LOAD_CALLSITE_VAR`140 `STORE_CALLSITE_VAR`141 |
| 6h | `HOST_CALL_ASYNC`41 `HOST_ACTION_CALL_ASYNC`45 `AWAIT`50 |
| 6j | `ACTION_CALL_ASYNC`43 (the last opcode - async non-host/bytecode action) |
| Reserved | `RESERVED_111`111 `RESERVED_112`112 - decode but permanently fault; **no handler, ever** |

6d / 6i add no new opcodes (6d swaps host-fn *implementations*; 6i is a host-action
capability over `HOST_ACTION_CALL_ASYNC`45). 6j implements the last opcode
`ACTION_CALL_ASYNC`43 and then verifies opcode completeness.

### Phase 6a: Managed Heap + Value Containers - ACCEPTED 2026-06-14 (host build)

`cpp/core/runtime/managed-heap.{h,cpp}`: a precise recursive mark-sweep collector + a
`SlabAllocator` (power-of-two segregated free lists, orders 5..16; `kMaxOrder` an
overflow guard above the region - the arena bound is the real limit) +
`ListObject`/`MapObject`. Container handle = the object's byte offset within the
`RegionArena` (`obj - arena.base()`, u32-safe). Collection is collect-on-alloc-fail at
the between-instruction safe points (alloc -> on fail collect over roots -> single
retry -> deterministic `StackOverflow`). `LIST_*` (90-99), `MAP_*` (100-104),
`TYPE_CHECK` (150) wired; `FiberScheduler` is the `GcRoots` source. Number-key equality
= SameValueZero; container indices are `int32_t` (no 64-bit ALU on Cortex-M4).

**Two blessed deviations:** the **map hash index is deferred** (ordered entry array +
linear scan; LD9 - parity-invisible, the ordered layout is what future iteration
needs); **borrowed string-key equality is by const-pool index** (a linker-dedup
guarantee - **managed-string keys need byte-content compare in 6c**). The root walk +
the collector's tracing extend in 6b (struct fields + closure captures). Full model in
the Heap And Value Memory Model section.

### Phase 6b: Structs + Closures - ACCEPTED 2026-06-14 (host build)

Closed/program-local structs + closures, host-parity. As built:

- **Closed structs:** `StructObject` = a fixed `slotCount` `Value` slab (sized from
  TYPS `StructOf.slotCount`), its own `Pool<T>`, GC-traced. `STRUCT_NEW` (reserved-0
  `a`, optional type-index `b`), `STRUCT_GET_FIELD`/`STRUCT_SET_FIELD <fieldId>`
  (direct slot; OOB read -> nil, write -> drop); `RESERVED_111`/`112`
  decode-and-fault. (Native-backed structs remain 6f4; binary structs are always
  closed.)
- **Value semantics:** `STRUCT_SET_FIELD` is a pure store; recursive struct-only deep
  copy at `STRUCT_DEEP_COPY` and the extended 3b `STORE_VAR_SLOT` (peek -> copy -> pop
  keeps the source rooted); self-referential structs terminate via a `copying` guard.
- **Name-keyed degrade (option (a), as planned):** `GET_FIELD` -> nil, `SET_FIELD` ->
  no-op, `STRUCT_COPY_EXCEPT` -> a fresh all-nil struct of the operand type. C++ and
  the TS binary path are in the same position (no field names), so it mirrors the
  oracle byte-for-byte. The field-name re-stringing follow-up (below) is NOT started.
- **`INSTANCE_OF` (151):** integer TYPS-index compare (`value.typeId() == a`),
  bounds-checked.
- **Calls/closures:** `CALL`, `CALL_INDIRECT`/`CALL_INDIRECT_ARGS` (strict vs
  truncate/nil-pad), `MAKE_CLOSURE`/`LOAD_CAPTURE` (`CapturesObject` heap kind), via a
  shared `pushCallFrame`. The 6a collector now traces struct slots + `Function`
  captures (+ sweeps all 4 pools) - no new root source (they sit on the stacks/locals
  the FiberScheduler root walk already enumerates).

**Blessed deviations:**

- **Struct-sizing seam (parity-correct):** C++ sizes structs to TYPS `slotCount`; the
  TS binary path grows a sparse 0-slot array. Observably identical for id-based access
  - this is *why* the name-keyed degrade matches the oracle.
- **Deep-copy GC-safety = a pin chain (accepted).** Recursive allocating `deepCopy`
  keeps in-flight parent copies rooted via a C++-call-stack `PinNode` chain registered
  in `DeepCopyRoots` (the sanctioned "RAII root handle where unavoidable"; no
  cap-sized buffer). Accepted because the failure (a nested-struct deep-copy
  triggering a collection on an inner alloc) is reachable on-device and no other layer
  covers it. **Caveat:** not deterministically test-exercisable (collect-on-alloc-fail
  can't be forced mid-inner-copy); a future debug "collect now" hook would let a test
  pin it.

Gate (all green): the `struct-closure` golden (9 set-pixel surfacings/tick x3 -
deep-copy / `STORE_VAR_SLOT` aliasing broken, name-keyed degrade, `INSTANCE_OF`,
`CALL`, closure capture + `CALL_INDIRECT`, args truncate/pad) byte-matched;
`managed-heap.test` (struct/captures trace + reclaim, self-ref cycle + deep-copy
termination, alloc-pressure collect-retry); `cpp/check.sh` x3 incl. UBSan; 199 cpp +
109 wodal tests.

### Struct field-name re-string (format v3) - LANDED in Phase 6f1 (2026-06-15)

The committed 6b follow-up. 6b shipped option (a) - the name-keyed struct fallback
degraded silently (both C++ and the binary oracle returned nil/no-op, so the gate stayed
green while real brains using the feature mis-ran). 6f1 re-strung struct field names into
the TYPS entry (format v2->v3) and wired `findStructField`, so dynamic computed-key
(`obj[expr]`) and object-rest (`{...x}`) struct access now **resolve** on the device.
Scope held (LD2): only the field name->id map returned; static `.field` stays id-based.
See the Phase 6f1 accepted summary for the as-built and gate.

### Phase 6c: Core Host-Function Library (f32) - ACCEPTED 2026-06-14 (host build)

`HOST_CALL` (40) dispatch (both id ranges; only **core** bodies land - target array
stub until 6i et al.) + every non-pinned `CoreFuncId` operator/conversion/builtin in
new `core-host-functions.{h,cpp}` (`VmRng`, `HostCallEnv`, `callCoreHostFunction`),
plus **dynamic (managed) strings**. (Carve-out, recorded after the fact: the
**context-variable ids 48-51** - `ctx.brain`/`ctx.rule` `getVariable`/`setVariable` -
were treated as "not core host-call bodies" and return `unsupported()`/`ScriptError`;
they need the execution context, so they are scheduled in 6f3, not here.) As built:

- **Managed-string layout (as planned):** immutable `Pool<StringObject>`
  (`{char* bytes; uint32_t length; bool mark}`) owning one `SlabAllocator` byte block;
  no grow; 64 KiB slab order the only bound. Value fills the reserved
  `kManagedStringRefBit` seam (`managedString`/`isManagedString`/`managedStringHandle`).
  Collector marks the header, frees the byte block on sweep.
- **`MapKey` extended** to `{isNumber, isManagedString, number, stringRef}`: string
  keys compare by **byte content across both representations** (borrowed-vs-borrowed
  keeps the index fast-path); collector traces managed-string keys; borrowed content
  resolves via the heap's new optional `const ProgramImage*`.
- **f32-native numerics, zero `double` / zero 64-bit int** (M4F is single-precision):
  native binary32 is bit-identical to the reference "compute f64 then `fround`" for
  `+ - * / % sqrt` (double-rounding innocuous: 53 >= 2*24+2; verified 0 mismatches /
  120M pairs). `ToInt32/ToUint32` use exact integer bit-manipulation; `Math.round`
  uses a `floor`-based form (exact via Sterbenz; naive `floorf(x+0.5f)` mis-ties near
  0.5). Removed a latent `float`->`int64_t` UB in `StrIndexOf`/`StrLastIndexOf`
  (clamp in `float` first). **Correction to the kickoff:** the interim
  "division needs a wider intermediate" claim was **wrong** - f32-via-f64 division
  does not double-round, so no f32 division artifact or 6d division-contract change
  is owed.
- **RNG seed pinned:** LCG `MathOps.random` (a=1664525, c=1013904223, mod 2^32,
  value = state/2^32), **seed = module default `1`** (random sensor + `MathRandom`
  share one stream); `VmRng` on `RuntimeSurface.rng`.
- **Pinned-deferred bodies fault `ScriptError`** (transcendentals,
  `ConvNumberToString`, `ConvStringToNumber`, `OpPowerNumber`) - the contract's
  HOST_CALL row already specifies `ScriptError` for host-side failure, so this
  conforms (no `vm-contract.md` edit); `HostError` stays reserved for a genuinely
  absent capability (null heap/rng). 6d lands the real bodies + removes the TS
  interim in lockstep.
- **Value-vector gate lives in wodal, not the `external/` submodule**
  (`core-host-fn-vectors.spec.ts` + committed `__fixtures__/core-host-fn-vectors.bin`),
  run through `createMicroBitV2Environment().brainServices` (real f32 profile); C++
  reads it via `MC_WODAL_FIXTURES_DIR`.
- The 6b deep-copy pin generalized to a public `Pin` RAII + `listReserve`;
  `collect()` now marks the pin chain, and a deterministic managed-heap test exercises
  collection-during-build (negative-control proven) - closing 6b's untested-pin gap.

Deferred (noted, not blocking): **string builtins are byte-oriented** - exact for
ASCII; non-ASCII (multibyte UTF-8 vs JS UTF-16 units) is an untested parity gap.
**List/map-producing bodies (`MapKeys`/`MapValues`/`StrSplit`) tag results
`typeId = kNoTypeIdx`** (standalone dispatch has no type registry; gate compares
content not typeId) - instantiated container type resolves at the type-registry
surface (**6f1**). **Context-variable ids 48-51** (`ctx.brain`/`ctx.rule`
`getVariable`/`setVariable`, reached by name via `HOST_CALL`) were carved out as "not
core host-call bodies" and fault `ScriptError`; they need the execution context and are
scheduled in **6f2** (the 628-vector gate did not cover them - they were not in the
"every non-pinned" set as built).

Gate (green): `core-host-fn-parity.test.cpp` 628/628 byte-match (every non-pinned id;
NaN/div0/overflow/`-0`/empty/clamp edges; string/list/map producers; RNG stream;
`Math.round` near-0.5; teeth proven by mutated-body negative controls) + managed-heap
GC tests (strings traced/reclaimed direct + via list + via map key; unified
content equality; `Pin`-survives-`collect`) + `HOST_CALL` opcode/fault tests;
`check.sh` x3 incl UBSan + clang-format + check-deps; TS core 912, wodal 110.

**For 6d:** numeric-contract direction is **"pin the correct f32 value; both sides
match it"** (device's native correctly-rounded f32 is ground truth, wodal emulates) -
transcendentals must not chase host `libm`; pin one chosen f32 impl both sides use.
No division/round contract change owed.

### Phase 6d: Pinned Numerics - ACCEPTED 2026-06-14

All 12 pinned f32 components landed in lockstep (TS reference + C++ device + shared
wodal vectors); no pinned `CoreFuncId` faults `ScriptError` anymore and no
transcendental/`formatNumber` f64-delegate slot remains in `profile-numerics.ts`.
As built:

- **10 transcendentals** (`pow,sin,cos,tan,asin,acos,atan,atan2,exp,log`): ported
  from **Cephes single-precision** (Moshier), rewritten in explicit binary32, **zero
  `double`**. TS `binary32-transcendental.ts` (per-op `Math.fround` helpers) mirrors
  C++ `binary32-transcendental.{h,cpp}` (native `float`); shared Horner helper;
  `exp`/`log` use loop-based exact power-of-two `frexp`/`ldexp` (no bit access ->
  Luau-safe). `pow` is NOT cephes `powf` - it is ECMAScript special-cases + exact
  binary-exponentiation for integer exponents + `exp(y*log|x|)` general; out-of-domain
  / non-finite -> NaN (JS-consistent, vs cephes 0; ungated, TS==C++ holds).
- **`formatNumber`** (`ConvNumberToString`): Ryu f2d (Adams; Apache-2.0/Boost, float
  tables) + ECMAScript `String(Number)` grammar; shortest-f32 (changes the 6c interim
  shortest-f64 output). TS Luau-safe (pure-`number` limb `mulShift`, no BigInt);
  C++ `uint64` + `memcpy` decode, no `double`.
- **`parseNumber`** (`ConvStringToNumber`): TS **unchanged** = `fround(Number.parseFloat)`
  + NaN->0 (parseFloat IS the grammar oracle, not a deferred delegate). C++
  `binary32-parse.{h,cpp}` = integer-only strtod (parseFloat grammar + correctly-rounded
  decimal->f64->f32, double-rounding via stack BigInt, no `double` type); caller maps
  NaN->0.
- **`-ffp-contract=off`** set per-source on the three `binary32-*.cpp`
  (`set_source_files_properties`) - without it arm64 fuses `a*b+c` to FMA and
  diverges; guarded by `binary32::multiplyAddRoundsTwice()` + a test (1 with flag /
  0 without).

Gate (green): new wodal `pinned-numerics-vectors.spec.ts` -> committed
`__fixtures__/pinned-numerics-vectors.bin` (**2014 records**, MCV1 reused from 6c) read
by `cpp/test/pinned-numerics-parity.test.cpp` (**6270 assertions**) via
`MC_WODAL_FIXTURES_DIR`; negative control proven (mutate one coefficient -> 20 vector
failures). `cpp/check.sh` green debug+release+sanitize (ASan+UBSan) + clang-format +
check-deps; core TS 911 + Luau (`rbxtsc`) typecheck + Biome clean; wodal 111.

Accepted deviations (reviewed): the C++ parser uses fixed function-local **stack
scratch** (`kMaxLimbs=160` worst-case 122; `kMaxSignificantDigits=768` + sticky bit) -
bounded `strtod` algorithmic working storage, not a runtime pool (LD7 N/A).

Size note (CLOSED - do NOT re-flag): the implementer flagged the `HOST_CALL` `switch`
referencing every builtin (so `--gc-sections` cannot drop, e.g., `sin`) and mused about
sparse/per-program dispatch. **That is infeasible by construction**: the deploy model
(5a/5b/5c) links ONE generic firmware, then the patcher writes the user program into a
flash region of the already-linked image (a pure byte transform; the web flow flashes a
vendored prebuilt firmware with no C++ toolchain). The linker never sees the program, so
every builtin is reachable-by-some-brain and must stay resident; selective elimination
would require per-brain firmware relink, which the patch-in-after-build design rejects.
The only valid size levers are program-agnostic (smaller/shared builtin code) - already
largely taken via the no-`double`/no-`printf`/no-`strtod` constraints. Bit-exactness
itself is size-neutral.

### Phase 6e: Exceptions, Yield, and the Grow-On-Demand Stack Arena - ACCEPTED 2026-06-14

Control-flow opcodes (`TRY`/`END_TRY`/`THROW`/`YIELD`, C++ mirror of vm.ts) plus the
grow-on-demand stack arena that **removes `FiberWorkspace` - the last LD7 worst-case
reservation in `cpp/`**. As built:

- **THROW/handlers:** the topmost handler always matches (no type match) - truncate
  frames to `handler.frameIndex`, recompute `localsDepth` from the surviving top frame,
  truncate the stack to `handler.stackHeight`, push `Value::error(code)`, jump to
  `catchTarget`; no handler -> fault; re-throwing an `Err` preserves its classifier.
  `END_TRY` pops (no-op if empty). `YIELD` advances pc and returns `Yielded` -> the
  scheduler re-enqueues for the next round. Handlers hold only indices/pcs - **not GC
  roots**. `assertCanSuspend` (the YIELD-in-sync-action fault) is intentionally OMITTED
  as unreachable until 6f2's sync bytecode-action frames; **6f2 must add it** (carried in
  the 6f2 section).
- **Grow-on-demand arena:** `FiberWorkspace` deleted. New `StackRegionAllocator`
  (`core/runtime/stack-region.h`) - its **own** `SlabAllocator` instance over the shared
  `RegionArena`, reusing the list-backing realloc pattern. Four per-fiber regions
  (stack/locals/frames/handlers) start small (initial 8/4/2/1, from device-golden peak
  depths) and grow geometrically toward the `kMax*` caps. `ExecutionState` gained the
  cap/capacity split (`*Limit` = fixed guard, `*Capacity` = allocated), a handler
  region, and a trivially-copyable `allocator` pointer; `pushValue` now takes `Value` by
  value (a grow can relocate the region). Regions are freed only at terminal sweep;
  YIELD/budget-suspended fibers retain them across rounds.
- **Cap reconciliation (LOCKED 256/256/64/16):** added `maxLocalsSize` to the TS
  `VmConfig` (`DEFAULT_VM_CONFIG=4096`, leaving non-device/f64 effectively unbounded),
  enforced at every frame push + root frame. The microbit-v2 profile now declares all
  four caps, threaded `device-profile.ts` -> `runtime.ts` -> `BrainRuntime` -> `new VM`
  options (root-cause fix: the VM previously received NO caps and silently used the
  4096/256/64 defaults). C++ `kMax*` already these values.

Deviations (accepted): stacks use a **dedicated** `SlabAllocator` (not the heap's),
required for heap-less fibers to run; consequence - a stack grow **never collects** (a
separate slab cannot benefit from heap GC), faulting `StackOverflow` only on arena
exhaustion, so the planned collect-on-fail-mid-grow caution is structurally avoided (the
post-grow base re-derivation, via by-value `pushValue`, is still needed). The grow
allocator pointer lives in `ExecutionState`. `vm-contract.md` was updated in the same
unit (six caps incl. `maxLocalsSize` in the `StackOverflow` enumeration + config table)
per vm.instructions.md; that external reference is the active contract anchor until a
repo-local `docs/specs/contracts/vm-contract.md` exists - carry these edits over if that
copy lands.

Gate (green): new exceptions-yield trace golden (wodal generator + committed
`.mcprogram.bin`/`.trace` + C++ trace-parity case: YIELD round-boundary, same-frame
catch, cross-frame unwind); `cpp/test/control-flow.test.cpp` (caught/uncaught/
cross-frame/rethrow, handler overflow at 16, grow+overflow at stack 256 / frames 64 /
locals / handlers 16, GC over a grown stack); new wodal `overflow-caps.spec.ts` (oracle
faults at the device caps, proving the threading + the new locals bound). `check.sh` x3
(debug/release/sanitize+ASan+UBSan); core 911, wodal 116; no fixture regen.

Phase 6f is **the milestone that makes real microbit-v2 brains runnable** on device,
beyond the host-only `button-display` slice (which 5c already deploys). It was the
heaviest single phase, so it is split into four sub-phases along their natural seams
(decided 2026-06-15): the static type/struct metadata (6f1), the bytecode-action
execution model (6f2), the context-variable host functions (6f3), and the native device
surface that reaches the milestone (6f4). 6f2 and 6f3 are independent of each other and
each need only 6b/6e; 6f4 needs 6f1 + 6f2 (with 6f3 landing first so a stateful tile
does not hit a silent fault at the milestone). Much of the data scaffolding
already exists - the opcodes (`ACTION_CALL`=42, `LOAD/STORE_CALLSITE_VAR`=140/141), the
decoded actions table (`program.h` `BytecodeAction` + `ActionCallSite` +
`ProgramImage::actions`/`hasActions`, including the lifecycle funcIds), callsite-state
storage (`execution-context.h` `bindSlots` -> `states[]`/`present[]` +
`currentCallSiteId`), the device ports (`microbit-ports.h` `setPixel`/`isPressed`), and
the target ABI mirrors (`microbit-field.h`: `Display`=0/`ButtonA`=1/`ButtonB`=2/`Logo`=3,
`CONTEXT_MICROBIT_FIELD_ID`=6).

#### Phase 6f1: Struct Field-Name Re-string (v3) + Type-Registry Foundation - ACCEPTED 2026-06-15

Static type/struct metadata, TS + C++ in lockstep. As built:

- **Re-string (format v3):** `BINARY_PROGRAM_FORMAT_VERSION`/`kBinaryProgramFormatVersion`
  2->3 (reader still rejects any other version; no migration); dump version 1->2. The TYPS
  struct entry now writes `fieldCount` + `(nameStringIdx, fieldId)` pairs (names interned
  into CSTR); decoded into a new `ProgramImage::structFields` pool
  (`StructOf.fieldsOffset/fieldsCount`) and the TS `ProgramTypeEntry.fields`.
  `GET_FIELD`/`SET_FIELD`/`STRUCT_COPY_EXCEPT` now **resolve** (no longer degrade) on both
  VMs (`SET_FIELD` deep-copies, mirroring vm.ts). Scope held (LD2): only the field
  name->id map returned; static `.field` stays `STRUCT_GET_FIELD <fieldId>`.
- **Type registry:** new C++ `TypeRegistry` (`core/runtime/type-registry.h`) over
  `const ProgramImage*` (`structSlotCount`, `findStructField`, `find{List,Map,Atom}Type`,
  `nativeStructGetter`/`Setter`), on `RuntimeSurface` as `const TypeRegistry* types` +
  threaded into `HostCallEnv`. 6b's `STRUCT_GET/SET_FIELD` rewritten into
  `readStructFieldById`/`writeStructFieldById`; the native getter/setter branch is present
  but never taken (no env types until 6f4).
- **6c carryover closed:** `MapKeys`->`List<keyType>` (default `String`),
  `MapValues`->`List<Any>`, `StrSplit`->`List<String>`, resolved via the registry
  (`kNoTypeIdx` only when the program lacks the type).

Blessed decisions: (1) **field-name resolution lives in the program type table, not a
host registry** - both VMs fall back to `prog.types[idx].structOf.fields` /
`findStructField` for program-local structs (truest mirror; no fabricated field typeIds;
no `runtime.types` registration at load). (2) `INSTANCE_OF` unchanged (type-table-index
equality IS the program-local identity; env identity is 6f4). (3) The container-typeId
gate uses a **table-free structural typeId** (`atom <id> | list <elem> | map <k> <v> |
none`) both VMs encode independently - so the assertion shares no table indices.

Gate (green): new `dynamic-field-access` golden (`Point{x,y}` via `obj[expr]` /
`obj[expr]=v` / `{...obj}`-minus-field; byte-matched C++ <-> oracle); value-vector gate
628/628 now asserting container typeIds; **all `.mcprogram.bin`/`.dump` regenerated to v3**
(no v2 stragglers; traces unchanged - semantics identical). `check.sh` x3 (ASan+UBSan) +
clang-format + check-deps; core TS 911, wodal 117; Luau build passes. `vm-contract.md`
updated in-unit (struct `fields`, TYPS row, version 2->3, resolution note).

#### Phase 6f2: Bytecode-Action Execution Model - ACCEPTED 2026-06-15 (host build)

C++-only mirror of vm.ts/brain-runtime.ts; no contract change owed. As built:

- **`ACTION_CALL` (op 42, sync):** operands a=actionSlot/b=argc/c=callSiteId; enters the
  action's entry function via 6b's `pushCallFrame` (extended with a
  `(hasActionBinding, ActionFrameBinding)` param, `isAsync=false`); args lay out as
  locals like a direct call.
- **Per-callsite slot pad (NEW storage - kickoff deviation).** The existing
  `callSiteStates`/`present` is the host-state cell (TS `getHostState`), **not** the
  `LOAD/STORE_CALLSITE_VAR` pad. Added `ExecutionContext.callSiteSlots` (flat
  `callSiteCount x callSiteSlotStride`), a program-derived `callSiteSlotStride` (max
  callsite-var operand + 1, scanned at startup - LD7-consistent with
  variableCount/callSiteCount), and `callSiteAllocated[]` (initializer once-guard).
  `LOAD/STORE_CALLSITE_VAR` (140/141) resolve callSiteId via the per-fiber frame walk
  (`currentActionBinding` = TS `getCurrentActionBinding`); the legacy `callsiteVars`/-1
  wrapper path is intentionally not mirrored. `enumerateRoots` now marks `callSiteSlots`.
- **Page lifecycle** (`brain-runtime`): bytecode initializer (once, `ensureCallSite`) +
  activation (per-activation) on activate in call-site order, interleaved with the
  existing host `onPageEntered`; deactivation (per-deactivation) on leave. Added a
  minimal page-change FSM (`currentPageIndex_`/`desiredPageIndex_`, `requestPageChange`,
  `deactivateCurrentPage`); `think()` reconciles a requested change (deactivate old ->
  activate new) before stamping time (TS ordering). Hooks run synchronously via new
  `FiberScheduler::runActionHook` (one `kHookBudget` slice), sharing an `allocFiber`
  helper with spawn.
- **`assertCanSuspend`** (6e carryover): `YIELD` inside a sync action frame faults
  `ScriptError`; a bare/async-frame `YIELD` stays the legal 6e cooperative yield.

Deferrals: bytecode callsite-id resolves from the frame walk, so
`ctx.currentCallSiteId`/`currentRuleFuncId` bookkeeping is not maintained for the
bytecode path (only the context-var accessors need it -> `currentRuleFuncId` added in
6f3); action-frame `ruleFuncId` inheritance left `kNoFuncId` (as existing `CALL`; nothing
in 6f2 reads it -> 6f3). Deferred to 6f4: host `onInitialized`/`onPageExited` (no
`HostActionBinding` fields) + injected-ctx action entry (currently faults via
`pushCallFrame`'s arity check). Page **restart** (change to current page) is a documented
no-op.

Gate (green): `action-page-lifecycle` golden (2-page: args-as-locals, callsite state
persisting across calls + a page round-trip, lifecycle order, once-vs-per-activation) +
`sync-action-yield` golden (legal rule YIELD survives a round; illegal action YIELD ->
`fault 1 4`) + 2 control-flow unit tests; `check.sh` x3; core 911, wodal 119.

#### Phase 6f3: Context-Variable Host Functions (brain + rule, by name) - ACCEPTED 2026-06-15

Closes the last `CoreFuncId` carve-out (48-51); C++-only, no contract change. As built:

- **Dispatch:** `vm.cpp`'s `HOST_CALL` branches on `isContextVariableFunc` ->
  file-local `dispatchContextVariableFunc` (has program + `surface.context` + heap +
  current frame); other ids stay on `callCoreHostFunction`. Struct-method convention:
  arg0 = ignored receiver, arg1 = name, arg2 = value. Faults: `HostError` (no context;
  or no heap on the rule setter), `ScriptError` (missing/non-string name).
- **Brain (48/49), slot-backed:** `resolveBrainVarSlot` content-scans
  `program.variableNames` (via `contextVarNameBytes`, which tolerates a null heap so a
  heapless brain's borrowed-literal names resolve); hit reads/writes `ctx.variables[slot]`,
  an undeclared name reads nil / writes no-op. Blessed deviation: TS lazily allocates a
  slot on set of an undeclared name; C++ no-ops (gate avoids the divergence).
- **Rule (50/51):** new `ExecutionContext.ruleVarStores` = outer managed `MapObject`
  keyed by `ruleFuncId` -> inner managed `MapObject` (name->value); both reuse 6c maps,
  both lazy on first write (LD7), brain-lifetime. `ruleVarGet` walks own map then up
  `parentRuleFuncId` (ruleAncestors) -> nil; `ruleVarSet` writes own map only,
  intermediates pinned across collecting allocations. Mirrors `createRuleVariableServices`.
- **`currentRuleFuncId`:** resolved on demand at the accessor via
  `resolveFrameRuleFuncId(topFrame)` (frame's `ruleFuncId` else membership in
  `ruleFuncIds`); not maintained on the context.
- **Action-frame inheritance (the 6f2 deferral):** at `ACTION_CALL` entry the action
  frame's `ruleFuncId = resolveFrameRuleFuncId(caller)` (resolved before `pushCallFrame`,
  which can relocate frames).
- **GC:** `enumerateRoots` marks `ctx.ruleVarStores` (one root; recursion traces inner
  maps + contents).

Gate (green): new wodal `context-variables` fixture (root rule + child rule + sync
action, 3 ticks): brain get/set + miss; rule get/set + miss; ancestor inheritance (child
reads parent's var; child write does not appear in parent); action-frame inheritance
(action reads + writes the calling rule's store) - C++ byte-matches the TS golden. Two
GC tests: a reachable rule-var store survives collection; a container in a `callSiteSlots`
slot survives collection (closes 6f2's untested `enumerateRoots` marking). `check.sh` x3;
wodal 120. Over-build pass removed 4 redundant guards + a redundant handle re-resolve.

**Follow-up - REQUIRED, must close (decided 2026-06-15): CALL-frame rule inheritance is
NOT mirrored.** TS `CALL`/`CALL_INDIRECT` set the callee frame's `ruleFuncId` via
`resolveCalleeRuleFuncId` (= `resolveDirectRuleFuncId(callee) ?? resolveFrameRuleFuncId(caller)`),
so a rule/action calling a **non-rule helper** that touches `ctx.rule` inherits the
caller's rule. C++ `pushCallFrame` leaves `ruleFuncId = kNoFuncId` and the on-demand
resolver only inspects the top frame, so such a helper resolves to no-rule (read nil /
write no-op). Forwarding `ctx` into a helper is idiomatic and TS authors expect it to
work, so this silently mis-runs real brains - a correctness bug, not deferrable. Calling
a *rule* funcId matches on both sides (6f3's child-rule CALL exercises that); only the
non-rule-helper path diverges. Scheduled as the **6f4 entry prerequisite** (see there);
the fix mirrors `resolveCalleeRuleFuncId` on the `CALL`/`CALL_INDIRECT[_ARGS]` paths, the
same mechanism 6f3 used for action frames.

#### Phase 6f4: Native Device Surface - the User-Tile Milestone - ACCEPTED 2026-06-15 (host-gated; hardware hex built, pending the user's flash)

C++-only mirror of the wodal microbit-v2 module. `user-tile-button-display` runs
end-to-end: host-gated (byte-exact trace parity vs the oracle) + a patched hex built for
the user to flash. As built:

- **CALL-frame rule inheritance (the 6f3 entry prereq, closed):** new
  `resolveCalleeRuleFuncId` wired into `CALL`/`CALL_INDIRECT[_ARGS]` (inherited rule
  resolved from the caller before `pushCallFrame`, then written to the callee frame), so
  a non-rule helper's `ctx.rule` resolves to the calling rule. Gate: new
  `rule-helper-variables` parity fixture.
- **Native-struct value rep:** `Struct(typeId, discriminator)` with the discriminator in
  the unused `handle` (no slab, GC-inert). Mixed typeId key (deliberate): `ctx` carries
  the Context type's **program-table index** (`injectCtxTypeIdx`); device structs
  (MicroBit/Display/Button) carry their **type-atom-id** (1027/1024/1025) since those
  types are not in the program table. Discriminator: singletons = 0; a button = its
  `MicroBitField` id (encode in getters, decode in host-fn bodies as
  `disc - MicroBitField::ButtonA`).
- **Registry native getters (closes the 6f1 placeholder):** `TypeRegistry` gained an
  injected `Span<NativeStructTypeBinding>` (`setNativeStructBindings`, default empty);
  `native-struct-bindings.h` does pure identity navigation (Context field 6 -> MicroBit;
  MicroBit field 0/1 -> Display/Button), no port access.
- **Target host-function surface:** new core `host-function.h`
  (`TargetHostFuncBinding`/`findTargetHostFuncById`, mirroring the host-action pattern);
  `RuntimeSurface.hostFunctions` added (struct end, preserving aggregate inits);
  `HOST_CALL` funcId >= `TARGET_FUNC_ID_BASE` dispatches through it (unregistered ->
  `ScriptError`). `host-func-bindings.h`: `execButtonIsPressed`(1027) +
  `execDisplaySetPixelValue`(1024) over `DevicePorts`.
- **`ctx` injection (closes the 6f2 deferral):** inject `Struct(injectCtxTypeIdx, 0)` at
  the two TS sites only - root spawn (`startExecution`) and `ACTION_CALL`; `pushCallFrame`
  gained an `injectCtx` flag (true only for `ACTION_CALL`; plain `CALL` forwards ctx
  explicitly - why the CALL-inheritance prereq mattered). Injected ctx occupies local 0,
  args follow, arity check expects `numParams - 1`.
- **Dual-path trace parity:** the host-fn pixel write calls the same `ports.display->
  setPixel` as the 3c action path, so the tracing-display wrapper emits the identical
  `port display set-pixel` line.

Scope (LD9, from the fixture dump): built `Context.microbit` + `MicroBit.display`/
`buttonA` + `Display.setPixelValue` + `Button.isPressed`; NOT TouchButton/logo, buttonB,
`getPixelValue`/`clear`, threshold methods (unreferenced fields read nil). Device wiring:
`main.cpp` builds heap + registry (native bindings) + host-fn bindings on the surface;
firmware rebuilt (region 0x44000), patched hex
`MICROBIT.user-tile-button-display.hex` ready.

Gate (green): C++ 234 cases x3 (debug/release/sanitize incl ASan+UBSan); user-tile fixture
byte-matches golden, ends pixel (0,0)=255; wodal 122; biome + typecheck clean.
On-device flash is the user's sign-off (host-accepted).

Recorded seam (negligible, far-future): the mixed native-typeId scheme is collision-free
for the fixture; a hypothetical program with 1028+ types placing a managed struct at a
table index equal to a device atom id would collide.

#### Phase 6f5: Core Sensor/Actuator Host Actions - ACCEPTED 2026-06-16 (hardware-validated)

Fixed a real on-device fault: a timer/page-switch brain ran in the wodal sim but faulted
on device because the firmware bound only the 2 microbit host actions - the 8 **core**
host actions (`core-host-actions.h` ids 0-7) had no C++ bodies, so op-44 `HOST_ACTION_CALL`
resolved null -> `ScriptError` each tick (SwitchPage failing pinned page 0). Orthogonal to
6f4 (op 42 + native host-fns). As built:

- **All 8 actions** (SwitchPage/RestartPage/Yield/Random/OnPageEntered/Timeout/
  CurrentPage/PreviousPage) ported as **core, target-agnostic** bodies mirroring the TS
  sensors/actuators - one per file under `cpp/core/runtime/host-actions/{actuators,
  sensors}/` + `core-host-action-env.h` (`CoreHostActionEnv`: brain/rng/heap/roots) + a
  thin `core-host-action-bindings.h` aggregator (`makeCoreHostActionBindings`, 8 entries).
  Firmware action table = core 8 + microbit 2.
- **BrainRuntime additions:** `requestPageRestart` (cancel active fibers -> respawn from
  entry next think, no lifecycle events), `requestPageChangeByPageId` (pageId content
  scan), `getCurrent/PreviousPageId` (borrowed-string Values), `previousPageIndex_`;
  `requestPageChange` now mirrors TS (same-page -> restart; a real change cancels active
  fibers immediately).
- **Body state:** Timeout = a per-callsite 2-element managed `List` `[fireTime, lastTick]`,
  freshly allocated on each page activation, mutated in place, GC-rooted via
  `callSiteStates`; Random = the shared `VmRng` (seed 1, same stream as `MathRandom`);
  Current/Previous page = borrowed strings from the program string table; Yield = no-op
  (the `YIELD` opcode suspends).

**Scheduler-interrupt fix (general conformance, beyond the host-action surface - touches
the VM dispatch hot path):** added `ExecutionState.cancelled`; `FiberScheduler::cancel`
raises it; `runExecution` checks it at each instruction boundary and stops; the tick loop
preserves `Cancelled` (mirrors TS `runFiber`'s mid-run `state !== RUNNABLE` check). Effect:
a rule that triggers a page change/restart **from within itself** is now interrupted at
the next instruction (trailing actions abandoned), not run to completion. First exercised
here (in-rule page changes are new), but it is a VM-wide dispatch change.

Deviations: SwitchPage page-**name** fallback not mirrored (the decoded image carries no
page-name table; pageId scan only); out-of-range switch stays a no-op (pre-existing).
Over-build pass removed 4 dead guards (null rng/heap, page-index bound - ASan/UBSan
confirmed unreachable).

Gate (green): committed fixtures byte-matched cpp<->wodal exercising all 8 - `timer-brain`
(Timeout + SwitchPage-by-number + display), `core-host-actions` (SwitchPage-by-pageId,
RestartPage, Yield, OnPageEntered, CurrentPage, PreviousPage), `restart-interrupt`
(same-page switch abandons a trailing pixel write); C++ unit tests (Random vs reference;
same-page restart respawns vs resumes). `check.sh` x3 (ASan+UBSan); wodal 125.
**Hardware-validated** (user flashed `MICROBIT-timer-brain.hex`: ~1.8s -> timeout -> page
switch -> pixel lights).

### Phase 6g: Cap Parameterization - Topology Parity with TS - ACCEPTED 2026-06-16

A pure refactor + guard: the scheduling/resource caps now come from the device profile
(like TS), not global `constexpr` consumed directly - giving the caps-equal-profile
invariant (which drifted once at 6e) a structural home. As built:

- **New core `DeviceProfileCaps`** (`device-profile-caps.h`): 8 profile-agnostic fields
  (`defaultBudget`/`hookBudget`/`maxFibers`/`maxStackSize`/`maxLocalsSize`/
  `maxFrameDepth`/`maxHandlers`/`maxHandles`), mirroring the union of TS `SchedulerConfig`
  + `VmConfig` caps. (Named for the **device profile**, not the scheduler: TS has no
  single combined type, the owning aggregate is `WodalDeviceProfile`, and "scheduler"
  would scope it to one consumer and fragment if a non-scheduler cap is added.)
  `FiberScheduler` ctor now **takes** it
  (`(program, surface, arena, const DeviceProfileCaps&)`); `spawn`/`allocFiber`/
  `runActionHook`/`tick` read `caps_` - no default param, no internal `profileId`
  resolution.
- **Host supplies the values** (`cpp/targets/microbit-v2/abi/device-profile.h`):
  `kMicroBitV2DeviceProfileCaps` (1000/10000/100/256/256/64/16/0) + `kMicroBitV2NumericProfileId`
  = 1. The global `constexpr` caps in `fiber-scheduler.h`/`execution-state.h` are
  **deleted** (grep-clean). ~40 ctor sites threaded via one shared test helper
  (`cpp/test/device-profile-caps.h`).
- **`profileId` validated in the HOST** (`main.cpp`), faithful to TS (`runtime.ts`
  validates in the host facade, not the codec; the C++ reader is untouched). On mismatch:
  the existing Load-fault loop with a new core code **`LoadError::UnsupportedDeviceProfile`
  = 15** (core names it via the `mc L<n>` fault rendering; the host owns the comparison +
  raises it). No new fault machinery.
- **Cap-parity guard:** wodal `device-profile-caps-vectors.spec.ts` -> committed fixture;
  C++ `device-profile-caps-parity.test.cpp` reads it (`MC_WODAL_FIXTURES_DIR`) and asserts each
  named cap == `kMicroBitV2DeviceProfileCaps`, **replacing** the literal asserts. Covers the
  **7** caps the profile declares; `maxHandles` (=0) is in the struct but joins the
  fixture/guard in 6i. Negative control proven.

LD7/LD9 honored: no second profile, no `profileId`->caps registry, no core-side default;
`kMax*` semantics unchanged (still runtime guards, regions grow on demand). Pure refactor -
trace-parity goldens byte-match unchanged.

Gate (green): 237 C++ cases (goldens byte-match through the parameterized scheduler);
`check.sh` x3 (ASan+UBSan); wodal 126 (+1 cap emitter); Biome + typecheck clean.

**6i seam:** when 6i raises `kMaxHandles` > 0, add `maxHandles` to the wodal device
profile + the cap-parity fixture/guard - the `DeviceProfileCaps` field and the C++ value are
already in place.

### Phase 6h: Async Core - ACCEPTED 2026-06-16 (host-gated + timer-brain hardware regression)

The generic async machinery, a C++-only mirror of vm.ts (semantics were already core
contract: `vm-contract.md` + the Prep C "handle resumes join the next round" rule - 6h
invents no new contract). Hardware proof is the regression check (timer-brain re-flashed,
confirms the 6h core edits didn't break non-async execution); no async path runs on device
until 6i.

As-built:

- **Core `HandleTable`** (`cpp/core/runtime/handle-table.h`, `Pool<T>`-backed/LD7):
  `Handle{id, state, result, error, waitersHead, nextCompleted}`; `state` in
  `Pending`/`Resolved`/`Rejected`/`Cancelled`; `createPending` faults (`kNoHandleId`) at
  `maxHandles` (a runtime guard, never an array size); `resolve`/`reject`/`cancel` legal
  **only from `Pending`**, each **enqueues** the handle onto an intrusive completed queue.
  **New GC root:** `enumerateResults` marks each `Resolved` handle's `result`;
  `FiberScheduler::enumerateRoots` calls it.
- **Opcodes 41 `HOST_CALL_ASYNC` / 45 `HOST_ACTION_CALL_ASYNC` / 50 `AWAIT`** implemented.
  `AWAIT` settle map: `Resolved` -> push result; `Rejected`/`Cancelled` -> throw via the
  6e handler path (shared `throwError`, now used by THROW + AWAIT-reject + a top-of-loop
  `pendingInjectedThrow` check); `Pending` -> record an `AwaitSite` on `ExecutionState` and
  return `RunResult::waiting()`. `assertCanSuspend` honored (await / async-dispatch inside
  a sync action frame faults `ScriptError`).
- **43 `ACTION_CALL_ASYNC` left to 6j** - at 6h it still faults via the dispatch
  `default:`. It is the async, non-host (bytecode) action path (the brain compiler emits it
  for a rule awaiting an async non-host action; 6i's scroll is a host-*action* async, op
  45). Implementing it needs threading the scheduler into the `runExecution` hot path (a
  child-fiber spawn from inside dispatch), and no shipping fixture exercised it at 6h. **6j
  implements it** (the conformance phase requires every opcode - none stays deferred).
- **3c guard flipped.** The scheduler's `Waiting` arm now **parks** the fiber
  (`FiberState::Waiting` + `addWaiter`) instead of faulting `HostError`.
- **Settle = enqueue -> drain (out-of-loop-settle capable).** Settling only flips state +
  enqueues; `FiberScheduler::drainCompletedHandles()` resumes waiters (restore await site,
  push value or set `pendingInjectedThrow`, mark Runnable, enqueue) and frees the handle;
  `BrainRuntime::think()` calls it **after `tick()`, before `sweep()`**, so resumes join the
  next round (Prep C order). The path accepts a settle made **outside** the single-entry
  loop - exactly what 6i's CODAL listener needs.
- **Fiber-id-space fix (6f2 carry-forward).** C++ hook fibers (`runActionHook`) now draw
  from a **descending** inline id space (`nextInlineFiberId_ = 0xffffffff`, counting down),
  mirroring TS `nextInlineFiberId = -1`; unsigned-hex trace rendering matches TS negatives
  byte-for-byte. `spawn` keeps the ascending space.

Blessed deviation: async bodies get the **ephemeral stack view, not an owned snapshot**
(the contract says async = owned snapshot; no current consumer retains args, and a true
snapshot needs an LD7 buffer/pool - documented at the call sites, pull in when a consumer
retains). Over-build pass cut three C++-only items (`Handle::inCompletedQueue`,
`HandleTable::size()`, `RunResult::handleId`).

Gate (host): `async-handles.test.cpp` - 9 cases under a test
`kAsyncDeviceProfileCaps = withMaxHandles(kMicroBitV2DeviceProfileCaps, 16)` (microbit-v2
profile untouched at 0): await-resolve (resumes next round), reject (throws->faults),
cancel, multi-waiter resume order, inline-resolved, `HOST_ACTION_CALL_ASYNC`,
await-in-sync-action fault, no-capability fault, table-cap/settle guard. 247 C++ cases /
12191 assertions x3 (debug/release/sanitize incl ASan+UBSan), no golden regressed; wodal
126 (no TS files changed). Timer-brain re-flashed + verified (regression only).

**Open item carried to 6i: cross-VM wodal<->C++ async trace goldens - CLOSED at 6i.** At
6h, settling a handle on the TS oracle needed `VM.handles` (behind private `BrainRuntime.vm`
behind private `WodalMicroBitRuntime.loadedBrain`); the candidate routes were (a) an
accessor on the external-reference `BrainRuntime`, or (b) a wodal-local
`VM + FiberScheduler + injected HandleTable` harness. **6i made both unnecessary:** its
bound-resolver reshape lets the async body settle its own handle and the device drives
completion, so the real `BrainRuntime` generates the async golden (like button-display).

### Phase 6i: Display Scroll-Text - the First Async Capability (microbit-v2) - ACCEPTED 2026-06-17 (hardware-validated)

The first shipped async capability on microbit-v2 and the async core's on-hardware
proof: an **async** `display.scroll(text)` host action - the calling fiber AWAITs a
handle and resumes when the scroll completes. Built on 6h. C++ scroll golden byte-matches
the wodal golden; validated on real hardware (single scroll AND a repeating
`DO [scroll text]`).

As-built:

- **Authoring surface.** Async host **action** `DisplayScroll` (id **1026**, key
  `microbit-v2.display-scroll`, fnId `ActuatorDisplayScroll` **1035**), dispatched via
  `HOST_ACTION_CALL_ASYNC` (op 45); tile label "scroll text". One optional anonymous
  String text arg (`WodalMicroBitV2ParameterId.Text` = `microbit-v2.text`), default
  `"hello"`. Port signature `PixelDisplayPort::scrollText(const uint8_t* bytes, uint32_t
  length, uint32_t delayMs, mc_number_t requestTimeMs, AsyncHandle handle)`, default step
  delay 120 ms. Confirms the precedent: awaited effects = actions.
- **Pinned completion-time formula (target layer, NOT core `vm-contract.md`):**
  `completionTimeMs = startTime + (displayWidth + spacing) * (charCount + 1) * delayMs`
  = `startTime + 6 * (charCount + 1) * delay` (`charCount` = `ManagedString::length` /
  UTF-16 length, ASCII). Pinned in wodal `display-scroll.ts` + C++ `display-scroll.h`,
  each cross-checked against an independent `updateScrollText` stepping simulation. The
  awaiting fiber resumes at the first think `>=` that time; logical completion is the
  formula against VM tick `time`, never rAF/wall-clock.
- **Core async reshape (`external/mindcraft-lang`) - the load-bearing change.** The async
  host-call path could not settle a handle from the body (only tests resolved, via a
  closed-over `HandleTable`). Reshaped to a **bound resolver** `AsyncHandle { id;
  resolve(value); reject(code, message?); cancel(message?) }` (`runtime/value.ts`), passed
  as the 3rd arg to both async paths (`HostAsyncFn` / `AsyncHostActionFn` /
  `HostActionBinding.execAsync`), built in VM dispatch from `this.handles` (tolerant -
  no-op when not pending). C++ mirror: `AsyncHandle` in `handle-table.h` + both typedefs +
  both dispatch sites. **No bytecode / `vm-contract.md` change** (host-binding API only).
  Record: `generated-docs/async-host-resolver-reshape-2026-06-16.md`.
- **maxHandles raised 0 -> 8** in the microbit-v2 profile (TS `device-profile.ts` + C++
  `device-profile.h`) via the 6g seam; 8th cap added to the wodal
  `device-profile-caps-vectors` fixture (.bin regenerated) + the C++ parity test. Runtime
  guard (LD7), never a pool size.
- **Trace contract (target `observable-trace`, format v1 - ADDITIVE, no version bump):**
  `action <id> site <cs> args <argc> <vals> async` + `port display scroll "<bytes>"`;
  `VmObserver.onHostActionCallAsync` added (non-pure, default-empty). Existing goldens
  byte-unchanged (additive-under-v1 avoids cross-stage golden regen). Action ids render
  lowercase hex (1026 -> `402`).
- **Visual parity (sim only).** Ported CODAL `pendolino3` 5x5 font byte-for-byte to
  `packages/wodal/src/core/bitmap-font.ts` (a generic codal-core primitive, beside
  `led-matrix.ts`); `MicroBitDisplay` renders `updateScrollText` (shift + paste glyph
  columns). On device CODAL renders glyphs natively - **no C++ font port**.

Blessed deviations from the original 6i design (the prior plan text is superseded):

1. **Device resolution = formula poll, NOT the CODAL `ANIMATION_COMPLETE` bus event.** On
   hardware the queued message-bus listener did not fire (rule stuck after one scroll).
   Replaced with a formula poll: the device port records `completionTime = now +
   scrollDurationMs`, and `pollScroll()` (each main-loop tick before `think()`, mirroring
   the host gate's `advanceScroll`) settles the handle. Event-independent; the same model
   the host trace golden proves.
2. **Concurrent scrolls = REJECT, not serialize.** The LD9 pass removed the serialization
   queue (a pre-sized fixed buffer of arbitrary size 8 - an LD7 violation, untested on
   C++). A scroll requested while one is active settles its handle immediately (the `AWAIT`
   sees it resolved and the rule continues without parking). Single active scroll; this
   also fixed a sim brain-reload bug (no absolute-time busy clock to go stale).
3. **No separate cross-VM oracle harness needed (closes 6h's open item).** Because the
   bound-resolver reshape lets the body settle its own handle and the device drives
   completion, the **real `BrainRuntime`** generates the golden (like button-display).
   6h's deferred cross-VM async-oracle item is closed - route (b) was not needed.

Over-build pass removed (do not re-add): the fixed scroll queue (both VMs);
`SCROLL_BITMAP_FONT_WIDTH` / `kScrollBitmapFontWidth` (dead); C++ `scrollCompletionTimeMs`
(unused in prod); a duplicate `kDisplayScrollDelayMs` (deduped to `kScrollDefaultDelayMs`);
a defensive `env.heap != nullptr` guard.

Gate (green): wodal 139/139; C++ `check.sh` x3 (debug/release/sanitize incl ASan+UBSan) -
252 cases / ~12,232 assertions, clang-format + check-deps clean, C++ scroll golden
byte-matches the wodal golden (`display-scroll.mcprogram.bin` + `.ticks.trace`), pixel
(0,0) lit; core 913/913; **hardware-validated** (single + repeating scroll).

Open follow-up (deferred): a **managed/computed-string scroll golden/test**. Borrowed/
literal strings are gated; the body's byte-read (`extractStringValue` / C++
`heap->stringContent`) already handles managed strings, so support is
implementation-complete - only the test is missing.

New durable artifact: `docs/specs/tiles/display-scroll.md` (first `docs/specs/tiles/`
entry; the template for future tile specs).

### Phase 6j: Conformance + Parity Suite - ACCEPTED 2026-06-17 (host-gated; PHASE 6 COMPLETE)

The capstone: the C++ VM is now a **fully conforming VM** - every contract opcode
implemented, zero `default:`-fault paths. Host-gated (no reflash; the core changes are
standard C++17 the firmware picks up via the auto-wired spawner, and op 43 is unreachable on
current microbit-v2 brains). With 6a-6j accepted, **Phase 6 is COMPLETE**.

As-built:

- **op 43 `ACTION_CALL_ASYNC` (the last opcode).** New narrow core interface
  `AsyncActionSpawner` (one method) on `RuntimeSurface::spawner`, implemented by
  `FiberScheduler` (breaks the dispatch<->scheduler include cycle; mirrors TS
  `Scheduler.addFiber`). The vm.cpp arm mirrors `vm.ts execActionCallAsync` **bytecode
  branch only** (no host branch - `program.actions` are bytecode-only; host-async is op 45).
  New `ExecutionState.asyncResultHandleId`; child fibers draw the descending inline id space;
  `tick()` settles the child's result handle (resolve on Done, reject on Fault), `cancel()`
  cancels it; `allocFiber` gained an args param. Zero `default:`-fault opcodes remain.
- **Opcode-completeness check** (`vm.test.cpp`): an `isImplementedOp` manifest asserted over
  `kOperandSchema` minus the two RESERVED numbers (the work also surfaced + closed a latent
  `HOST_CALL` gap).
- **Carve-out gate** (new `conformance.test.cpp`), both surfaces: (a) every `CoreFuncId`
  classified HostCall/ContextVariable/HostAction - unclassified -> `Unsupported` fails the
  gate (allow-list empty); (b) every core host-action id 0-7 has a registered binding with a
  body (closes the 6f5-class gap).
- **Opcode-coverage measurement** (`conformance.test.cpp`): unions opcodes across the wodal
  golden corpus and asserts every non-reserved opcode is covered. Authored one
  `opcode-coverage` conformance brain for the 11 ops no other golden reached
  (DUP/SWAP/STACK_SET_REL/JMP/JMP_IF_TRUE/END_TRY/LIST_SET/SHIFT/REMOVE/INSERT).
  `HOST_CALL_ASYNC` (41) is golden-unreachable on microbit-v2 (no async host *function*) ->
  explicitly annotated unit-test-covered (async-handles).
- **New goldens** (wodal `__fixtures__/`, via the existing harness, each with a C++
  trace-parity case): `async-action` (device-free op-43), `opcode-coverage`,
  `pixel-conversion`, `managed-string-scroll` (the 6i follow-up).
- **Managed-string trace-writer fix** (surfaced by `managed-string-scroll`): the C++
  `ObservableTraceWriter` renders managed string args via `heap->stringContent` (optional
  `setHeap`); borrowed strings unchanged.
- **Build hygiene confirmed by construction:** the host-only emitters now live in
  **`cpp/hostkit`** (outside the firmware's `cpp/core` glob); `AsyncActionSpawner` is
  legitimate VM core. (The standalone emitter-relocation cleanup is thus done.)

**Port-crossing numeric-typing seam - resolution REVISED (supersedes the recorded option
B).** The recorded option B ("keep the u8 `PixelDisplayPort`; pin an f32->u8 discard/clamp")
was found ungrounded - 255 was the u8 width, not the device coordinate space. The as-built
resolution **matches CODAL exactly:** the display is
`Image::setPixelValue(int16_t x, int16_t y, uint8_t value)`, which **early-outs (no write)
for coords outside 0..dimension (5x5)** and **does not clamp brightness**. So
`PixelDisplayPort::setPixel` coords change **u8 -> int16**; the conversion is **pure
narrowing** (coord f32->i16 truncate; brightness f32->u8 truncate+wrap, no clamp, no
discard) applied identically on both VMs; **every** call crosses the port and emits a
`port display set-pixel` line with the narrowed args; the **device** performs the matrix
early-out for the store. In-matrix integer coords narrow as the identity, so all goldens
except `pixel-conversion` are byte-unchanged. Pinned in the new
**`docs/specs/contracts/observable-trace.md`** (the repo's first local contract doc).

Blessed deviations: op-43 host branch omitted (no C++ analog); the result handle is
`createPending`'d before `allocFiber` (no orphaned child on a handle-cap failure; the ids
are independent counters); no `BytecodeAction.isAsync` assertion (the opcode determines
async).

Gate (green): `cpp/check.sh` x3 (debug/release/sanitize incl ASan+UBSan) + clang-format +
check-deps clean - **263 C++ cases / 12547 assertions**; wodal typecheck + biome clean +
**143** tests; core **913** (untouched). Host-gated (no reflash).

**Deferred from 6j (NOT in the gate; designs locked, pending a scheduling decision - see
Deferred Work):** the shared input-script file format + parsers (one consumer today), and
the instruction-level trace mode (touches the reference VM + the shipping dispatch hot path).

**Phase 6 invariants - now satisfied:** opcode completeness (every opcode implemented, none
faulting); parity holds across the golden set; the async host obligation is honored.
**PHASE 6 IS COMPLETE** (6a-6j; 6j host-gated, the surface hardware-validated through 6i).

---

## Phase 7: microbit-v2 Device-Surface Completeness (placeholder - refine after Phase 6)

The full microbit-v2 onboard sensor/actuator surface, on both TS and C++. 6f4 built the
**native device-surface mechanism** (native-struct rep, registry getters, the target
host-fn surface, device ports) but proved it on a slice (`display.setPixelValue` +
`buttonA.isPressed`); the device ABI today is only **display + buttons + touch** (4
`MicroBitField`s, 11 host-fns, 4 type-atoms). Accelerometer, gesture, temperature,
magnetometer/compass, GPIO, and the rest exist on **neither side**. This phase completes
them. It is microbit-v2-specific (the wodal module + sim, the ambient `Context` `.d.ts`,
`cpp/targets/microbit-v2/`) - target completeness, not VM conformance, hence its own
phase - and reuses 6f4's mechanism; it invents no new VM machinery.

**Deliberately under-specified for now; refine (and sub-split) after Phase 6 is
complete.** What the surface *is* is not yet known: it comes out of a two-stage front the
user owns -

1. **CODAL capability inventory** - catalog what the CODAL `MicroBit` API actually offers
   (`uBit.accelerometer`/`thermometer`/`compass`/`io.pinN`/gesture/... and the rest).
   **DONE 2026-06-17:** `generated-docs/codal-capability-inventory-2026-06-17.md` (sourced
   from the vendored CODAL headers; per-capability R/E + value-shape + sync/async +
   event/poll + injectable-input, grouped by family, with cross-cutting design
   observations). Stage 2 (the tile-language design) is the next step and is yours.
2. **Tile-language design** - decide *how* to surface that capability as sensors and
   actuators in the language. The exposed `Context` surface is the **output of this
   design**, not a given; the peripherals named above are CODAL inputs to it, not a
   committed scope list. Only after the design are the `Context` types/fields/methods and
   the ABI ids knowable.

**Adopted default stance (2026-06-17): poll on sensors, await on actuators with a temporal
quality.** This resolves the inventory's two load-bearing axes (event-vs-poll,
sync-vs-async) into a default, overridden only with cause:
- **Sensors -> poll.** A sensor surfaces as a value the rule reads each tick (a sync
  host-function read of the latest sample), NOT an event-tile by default. This sidesteps
  the 6i hazard (a CODAL message-bus listener that did not fire on hardware) and keeps every
  sensor deterministically trace-parity-checkable via the injected-input harness.
  Event-rich capabilities (gesture, button click/hold, claps, radio packets, pin edges) are
  derived from polled state unless a tile genuinely needs true event semantics - then a
  deliberate, separately-validated exception (the 6h out-of-loop-settle path is the
  mechanism, with its own on-hardware proof).
- **Actuators with a temporal quality -> await.** An effect that takes observable time
  (scroll, print, animate, sound-play, a timed move) surfaces as an async host-action (op
  45, the 6i scroll pattern: completion-time formula against VM tick, awaited).
  Instantaneous effects (set-pixel, brightness, a one-shot speed set) stay sync
  host-functions.

**Incremental - one peripheral at a time, NOT a big-bang.** Phase 7 proceeds
peripheral-by-peripheral; for each, the user owns the tile design (Stage 2 for that
peripheral), then it is implemented on both sides + gated, then the next. Each peripheral is
effectively its own thin sub-phase. **First peripheral: buttons - COMPLETE both VMs +
hardware-validated 2026-06-17** (`docs/specs/tiles/button-sensor.md` surface 1 +
`docs/specs/microbit-context.md` surface 2, both current). As-built notes worth carrying
forward: the four tiles' ids (`[A]` reused 1024/1033, `[B]` 1027/1036, `[A+B]` 1028/1037,
`[logo]` 1029/1038); the modifier default landed as **`pressed`** (changed from `click`
mid-implementation by user direction, for UX + to keep the press-lights-pixel tests valid);
thresholds long-click 1000 ms / double-click window 500 ms, no hold threshold; surface 2 omits
`buttonAB` (composable in user code). **The injectable sensor-input harness (scriptable down/up
per tick, both VMs) is now established and reusable by every later sensor.** A cross-cutting
invariant surfaced (see the native-struct field-order note below). Next peripheral TBD.

**Three surfaces per peripheral (locked 2026-06-17).** Each board capability is delivered on
ALL THREE:

1. the **brain tile language** - high-level end-user tiles a brain author drags
   ("temperature", "on shake", the button sensor); the per-peripheral tile design.
2. the **TS user-code surface** - a lower-level host-function API closer to the device
   `*Port` layer bound to CODAL `uBit` in `targets/microbit-v2/source/main.cpp` (the 6f4
   `ctx.microbit.*` pattern: `buttonA.isPressed()`, `display.setPixelValue()`), for
   TypeScript user code, including user-tile *libraries*. **NOT 1:1 with the tiles** - it
   tracks the device/port shape, not the tile semantics (e.g. the button *sensor* tile
   poll-derives click/hold/double from polled state, while TS user-code just gets
   `isPressed()`).
3. the **`apps/microbit-sim` UI affordance** - a way for a human to represent the
   peripheral's **inputs and outputs** in the simulator: for a sensor, an interactive control
   that injects the value/event (e.g. a gesture dropdown + a trigger button; a clickable/
   rotatable sphere with visible axes for x/y/z; the on-screen A/B buttons); for an actuator,
   a rendering of the effect (the LED matrix already renders display output). `apps/microbit-sim`
   owns this UI; it drives the **same wodal injectable-input path** the parity harness scripts
   - the UI is the interactive front-end to that injection, the harness the scripted one.

**As each peripheral is added, it must be delivered on all three surfaces** - extend the
tile(s), the `*Port` + `ctx.microbit.*` host-functions, AND the microbit-sim UI; designed
together per peripheral, shaped independently. Surface 2 is specified as a **single living
registry** in `docs/specs/microbit-context.md` (the ambient
`packages/wodal/ambient/mindcraft.microbit-v2.d.ts` is its type mirror) - one cross-cutting
`MicroBit` interface, not per-tile. Surface 3 is per-peripheral and documented in each tile
spec's **Sim UI** section.

The **edge-connector primitives** live on surface 2 and may have **no tile-language
counterpart at all** (they are library plumbing): **GPIO** (digital/analog/PWM/touch/pulse),
**I2C** (read/write a device register), and the native **IR receive** primitive (below).
**I2C is in Phase 7 scope (locked 2026-06-17):** committed consumer Cutebot (motors/servos/
LEDs are I2C@`0x10` writes), so it is not speculative - build the **minimal** write/read-
register primitive that consumer needs, not a general I2C abstraction. **SPI stays out** (no
committed consumer); pull it in only when something needs it.

**Native IR receive (NEC) is also a Phase 7 edge-connector primitive** (locked 2026-06-17 -
generalized out of Cutebot). The IR remote protocol (NEC: a 9ms lead + a 32-bit
address/command frame, 560us/1.7ms bit timing) needs microsecond pulse decoding the
round-based, budget-limited VM **cannot** do in bytecode (a ~70ms blocking tight-loop would
also stall the single-entry loop) - the same wall MakeCode hit, which is why the reference
`IR.cpp` is native C++. So it is a **native C++ host-function** in the firmware (a
port/adaptation of `IR.cpp`, ideally background/interrupt-driven so the read is non-blocking,
holding a "last decoded code" register like the onboard sensors), **polled** by the tile.
Shape it as a **general, pin-parameterized "read last NEC code on pin N"** primitive, not a
Cutebot-fixed one: NEC is the dominant consumer-IR protocol (TVs, the ubiquitous hobby
IR-receiver+remote modules, other micro:bit robot kits, a standalone "IR remote" education
tile), so one decoder backs both a future end-user IR tile and the Phase 9 Cutebot library.
**Hold the line at NEC only** - no RC5/RC6/Sony/other protocols (no consumer). This is the
one primitive that is a protocol *decoder*, not a raw bus/pin op; its committed consumer
(Cutebot) makes it non-speculative, and pin-parameterizing it is near-zero extra cost over a
Cutebot-private version.

Once the surface is designed, the build is downstream and reuses established machinery:
extend `DevicePorts`/`microbit-ports.h` per peripheral; expose in the ambient `.d.ts` +
the wodal module with **appended** ABI ids (`MicroBitField`/`MicroBitV2HostFuncId`/
`MicroBitV2TypeAtomId` - append-only, never renumber, LD2); reuse 6f4's `Struct(typeId,
discriminator)` native rep (e.g. a pin carries its pin number); implement both sides
mirroring; and gate with per-peripheral fixtures exercising every I/O, **no I/O
registered-but-untested** (the 6f5 binding-coverage lesson).

**Prerequisite refactor - reorganize the microbit-v2 target binding layer - DONE (2026-06-17, commit `921a5b2` "refactor (cpp): split monolithic files").** The previously-monolithic target binding files were split one-per-concern to mirror the cpp-core 6f5 layout: `targets/microbit-v2/abi/host-actions/{actuators/display-scroll.h, actuators/display-set-pixel.h, sensors/button-a.h}` + a thin `host-actions/host-action-bindings.h` aggregator; `targets/microbit-v2/abi/host-functions/{button-is-pressed.h, display-set-pixel-value.h, native-receiver.h}` + a `host-functions/host-func-bindings.h` aggregator. `native-struct-bindings.h` stays a single small registry (the plan's small-registry allowance; split it later if it grows). Pure refactor - goldens byte-unchanged, builds green. So Phase 7's per-peripheral build now drops new sensors/actuators into the per-concern structure, not a monolith.

Carry-forward notes for the refinement:
- **The injectable sensor-input harness exists** (built with buttons, 2026-06-17):
  deterministic, scriptable sensor inputs on both sides (scriptable wodal-sim peripherals +
  matching C++ host stub ports), down/up levels per tick - without it a sensor *read* cannot
  be trace-parity-checked. Host trace parity under injected values is the rigorous gate;
  **hardware is a per-peripheral manual smoke test** (user-gated). Reuse it for later sensors.
- **Native-struct field-order invariant (discovered with buttons, applies to every
  `ctx.microbit` field):** the compiler keys `STRUCT_GET_FIELD` by a native field's
  *position* in the registered fields list, NOT its declared `fieldIndex`. The wodal
  `MicroBit` field order must equal the cpp `MicroBitField` enum values (position == id) -
  **append a new `ctx.microbit` field LAST, at the next free id**, or reads silently swap.
  The ambient `.d.ts` is generated (`npm run generate:ambient`), never hand-edited. (Also in
  `docs/specs/microbit-context.md`.)
- GPIO analog/PWM crosses the **port numeric-typing seam**, now resolved (6j): follow the
  same CODAL-matching pattern - a port typed to the CODAL signature, pure f32 narrowing
  applied identically both VMs, the device doing any range/early-out, and the narrowed value
  in the trace (`docs/specs/contracts/observable-trace.md`).
- Dependencies: 6f4 + 6f5. Per the adopted stance: sensor reads are sync host-functions;
  temporal actuators await (op 45, the 6i scroll pattern).

---

## Phase 8: Virtual Radio in microbit-sim (sim-to-sim messaging) (placeholder)

Let multiple sims instantiated in `apps/microbit-sim` exchange **radio** messages, so a
brain running `radio.send(...)` on one sim is received by the others in the same group -
the sim counterpart of physical RF between real micro:bits.

- **Layer: sim + wodal, no VM/firmware change.** Radio `send`/`receive`/`setGroup` are
  surfaced as host functions/actions by Phase 7's **radio family** (the contract); Phase 8
  is the sim's *transport*: a shared in-app radio bus that delivers packets by group
  (respecting group match, payload, and RSSI semantics from the CODAL inventory). Real
  hardware already messages over real RF; this gives the sim the same observable behavior.
- **Single-entry-rule discipline:** an inbound packet is **enqueued** by the bus and
  **drained** into the receiving brain on a tick boundary (the 6h out-of-loop-settle path);
  no callback re-enters `think()`. Per the adopted default stance, receive surfaces as a
  **poll** (the brain reads the latest received message each tick) unless the button-style
  event exception is taken deliberately.
- **Gate:** two sims in the app, same group - one sends, the other receives the message
  deterministically; matches the Phase 7 radio host-fn contract. Sim-only (no
  hardware-parity gate beyond that contract; the transport is sim-specific).
- **Depends on** Phase 7's radio family (the radio surface must exist first).

## Phase 9: ELECFREAKS Cutebot Control via TypeScript User-Tiles (placeholder)

A TypeScript **user-tile** library to drive an ELECFREAKS Cutebot (a micro:bit robot car),
modeled on the `pxt-cutebot` MakeCode extension
(`github.com/elecfreaks/pxt-cutebot`, `cutebot.ts`) - reimplemented against Mindcraft's
user-tile + host-function APIs, not ported. Authored in the TS user-tile path (ts-compiler),
runs on the C++ VM on device + in the sim.

- **Cutebot surface (from the extension):**
  - **Actuators over I2C (addr `0x10`):** motors (independent L/R, -100..100), servos
    (S1/S2, 0..180 deg), RGB headlamp LEDs (L/R/both, RGB 0..255), convenience moves
    (forward/back/turn/stop; `moveTime(dir, speed, ms)`).
  - **Sensors over GPIO:** ultrasonic distance (P8 trig / P12 echo, cm or inch, up to
    ~500cm), line-tracking IR (P13/P14, on/off-line), IR remote receiver (P16, button
    codes).
- **All primitives come from Phase 7 (GPIO + I2C + IR-receive) - Phase 9 adds NO native
  firmware code.** Motors/servos/LEDs are I2C@`0x10` register writes; ultrasonic (P8 trig /
  P12 echo pulse) and line-tracking (P13/P14 digital read) ride Phase 7's GPIO; and the IR
  remote rides Phase 7's **native NEC IR-receive primitive** (generalized out of Cutebot -
  see Phase 7; the decode is native because the round-based VM can't do us pulse timing).
  Cutebot points the IR primitive at P16 and maps NEC command bytes to its button labels.
  So Phase 9 is a **pure TS user-tile library** on Phase 7 primitives + the existing
  user-tile path.
- **Stance mapping:** motor/servo/LED writes are instantaneous -> **sync** host-functions;
  `moveTime` (a timed move) is temporal -> **await** (op 45); ultrasonic/line/IR reads ->
  **poll** (IR polls the primitive's last NEC code).
- **Gate:** a user-tile brain drives a **modeled Cutebot in the sim** (trace-parity on the
  I2C/GPIO/IR host-call surface) + a **real-Cutebot hardware smoke test** (user-gated).
- **Depends on** Phase 7 (GPIO + I2C + IR-receive primitives); a pure TS user-tile library,
  no new native firmware code; independent of Phase 8.

---

## Phase Log

Condensed dated ledger of accepted phases (newest first). Full per-phase as-built
detail lives in the session memory and git history; the accepted phase sections above
carry the contracts each produced.

- **2026-06-18 - Phase 7 accelerometer A2 complete** (surface-2 TS reads;
  host/firmware-build-gated, hardware read smoke test pending user flash). 8 sync host-function
  reads `ctx.microbit.accelerometer.{getX/Y/Z, getPitchRadians/RollRadians, getPitch/Roll,
  getGesture}` over the A1 port, both VMs. New append-only ABI ids: `MicroBitField.Accelerometer=4`
  (appended LAST, count 4->5), `MicroBitV2TypeAtomId.Accelerometer=1028` (4->5), host-fn ids
  1039-1046 (count 15->23). **Singleton struct, NO discriminator** (unlike the buttons' shared
  body): the `accelerometer` field resolves to one struct value and each of the 8 reads binds a
  distinct body (cpp `accelerometer-read.h`, binding count 3->11; wodal
  `registerAccelerometerFunctions` + `Accelerometer` struct in module.ts; `microBitFieldGetter`
  resolves the new field, nil-receiver gap stays closed). Reads share the A1 port (one poll, both
  surfaces); no derivation added (degrees still derive-from-radians in the port). Ambient
  `mindcraft.microbit-v2.d.ts` regenerated (`Accelerometer` interface + `readonly accelerometer`),
  ambient spec passes, not hand-edited. Golden `user-tile-accelerometer-reads` (+ `.mcprogram`/
  `.bin`/`.ticks.trace`): 4-tick schedule injects gesture + x/y/z + pitch/roll-radians (tick 3
  sets nothing -> proves held; ticks 2/4 partial -> rest hold); cpp parity TEST_CASE in
  `trace-parity.test.cpp` (`SettableAccelerometer` with derived degrees). **A2 is a WIRING proof**
  (distinct injected values catch a cross-wire); value precision stays A1's port-level
  `accelerometer-read-vectors` (raw f32 bits, no display in the path). The split is forced by a
  cross-VM trace-parity bug on the user-tile `setPixelValue` host-function path (see Deferred
  Work). Gate: cpp check.sh x3 (275 cases, user-tile case 13 assertions), wodal typecheck+biome
  clean + 163, firmware Docker build exit 0 (CODAL reads linked), comment review pass. One
  unrelated `program-reader` invalid-atom probe bumped 1028->1029 (1028 is now the valid
  Accelerometer atom). Spec current: `docs/specs/microbit-context.md` (accelerometer wired). Next: A3.
- **2026-06-18 - Phase 7 accelerometer A1 complete** (port + injectable-input foundation;
  host/firmware-build-gated - no behavioral hardware test yet, the gesture tile lands in A3).
  Device port `AccelerometerInputPort` (`cpp/codal/device-port.h`, `accelerometer` appended LAST
  on `DevicePorts`): `getGesture()`, `getX/Y/Z()` (mg signed), `getPitch/Roll()` (whole deg) +
  `getPitchRadians/getRollRadians()`; CODAL binding `MicroBitAccelerometerInputPort` ->
  `uBit.accelerometer.*`. **Gesture enum `AccelerometerGesture` = CODAL `ACCELEROMETER_EVT_*`
  verbatim**, placed at the CODAL-common layer both sides (wodal `core/accelerometer.ts`, cpp
  `codal/accelerometer-gesture.h`): None0 TiltUp1 TiltDown2 TiltLeft3 TiltRight4 FaceUp5
  FaceDown6 Freefall7 Impact3G8 Impact6G9 Impact8G10 Shake11 **Impact2G12** - codes are NOT
  magnitude-ordered (A4's `>=` must map code->rank, not compare raw codes). **Orientation
  reshape (blessed deviation):** radians is the single internal primary, degrees DERIVED via
  CODAL's exact f32 formula `(int)(360*rad/(2*PI))` in both VMs (bit-identical JS/C++); the
  earlier duplicate degree fields + the wodal atan2 derivation were removed; injection setters
  are `setPitchRadians`/`setRollRadians` only (fround). `degreesFromRadians` is a device-model
  computation pinned f32, NOT a platform numerics API. A1 injects radians; emulating
  `recalculatePitchRoll` (x/y/z->radians) is A5a. Test-only injectable harness (wodal
  `Accelerometer` model + cpp host stubs); firmware exclusion structural (device links the
  CODAL port, the stub lives only in `cpp/test`). Read-back parity fixture
  `accelerometer-read-vectors.bin` (magic `MAV1`; per-tick setpoint mask + 8-field read-back,
  orientation radians-only) + `accelerometer-read-vectors.spec.ts` + cpp
  `accelerometer-read-parity.test.cpp`; gesture-enum pinning in `cpp/test/device-port.test.cpp`.
  No `MicroBitField`/`ctx.microbit.accelerometer`/`.d.ts` yet (A2; host-fn id count still 15).
  Specs current: `docs/specs/tiles/accelerometer-sensor.md` + `docs/specs/microbit-context.md`.
  Gate: cpp check.sh x3 (274 cases, parity case 87 assertions), wodal typecheck+biome clean +
  162 tests, firmware Docker build exit 0 (no injection hook).
- **2026-06-17 - Phase 7: buttons complete** (first Phase 7 peripheral; both VMs +
  hardware-validated). Surface 1: four sensor tiles `[A]`/`[B]`/`[A+B]`/`[logo]`, six
  mutually-exclusive modifiers (default `pressed`), poll-derived per-call-site state machine
  (long-click 1000 ms, double-click 500 ms, no hold threshold); the old button-A sensor
  overwritten (`[A]` reused id 1024/1033, the blessed LD2 exception; `[B]` 1027/1036, `[A+B]`
  1028/1037, `[logo]` 1029/1038). Surface 2: `ctx.microbit.buttonA/buttonB/logo.isPressed()`
  wired both VMs (fixed a real cpp gap - `microBitFieldGetter` had resolved only
  display/buttonA; no `buttonAB` - composable in user code). Established the reusable
  injectable sensor-input harness (scriptable down/up per tick, both VMs) and surfaced the
  native-struct field-order invariant (position == id; append fields last). Specs:
  `docs/specs/tiles/button-sensor.md` + `docs/specs/microbit-context.md`. Gate: wodal 160,
  cpp check.sh x3, microbit-sim 22, comment review pass, on-hardware smoke test pass.
- **2026-06-17 - Phase 6j accepted** (host-gated; **PHASE 6 COMPLETE**): the C++ VM is now a
  fully conforming VM - every contract opcode implemented, zero `default:`-fault paths.
  **op 43 `ACTION_CALL_ASYNC`** (last opcode): new narrow core `AsyncActionSpawner` on
  `RuntimeSurface` (impl by `FiberScheduler`, breaks the dispatch<->scheduler cycle, mirrors
  TS `Scheduler.addFiber`); vm.cpp mirrors `execActionCallAsync` bytecode branch only (host
  branch omitted - actions are bytecode-only); new `ExecutionState.asyncResultHandleId`,
  child fiber on the descending inline id space, `tick()` settles the result handle
  (resolve/reject), `cancel()` cancels it. Conformance gates: opcode-completeness manifest
  (`vm.test.cpp`, also closed a latent `HOST_CALL` gap) + the two-surface carve-out gate
  (`conformance.test.cpp`: CoreFuncId classification + host-action binding coverage,
  allow-list empty). Opcode-coverage measurement over the golden corpus + a new
  `opcode-coverage` brain (11 uncovered ops); `HOST_CALL_ASYNC` annotated unit-test-covered.
  New goldens: `async-action`, `opcode-coverage`, `pixel-conversion`, `managed-string-scroll`
  (+ a C++ managed-string trace-writer fix). **Port-seam resolution REVISED to match CODAL
  exactly** (supersedes the recorded u8 option B): `setPixelValue(int16,int16,uint8)` -
  coords narrow f32->i16, brightness f32->u8 truncate+wrap (no clamp), the device does the
  5x5 matrix early-out, every call emits a narrowed `port display set-pixel` line; pinned in
  the new `docs/specs/contracts/observable-trace.md`. Host-only emitters relocated to
  `cpp/hostkit`. Gate: 263 C++ cases / 12547 assertions x3, wodal 143, core 913. Deferred
  (not in gate): input-script file format (one consumer), instruction-trace mode (touches
  the reference VM + dispatch hot path).
- **2026-06-17 - Phase 6i accepted** (hardware-validated): async `display.scroll(text)` -
  the first shipped microbit-v2 async capability and the async core's on-hardware proof.
  Action `DisplayScroll` (id 1026, fnId 1035, op 45; optional String arg default
  `"hello"`). Completion-time formula `start + 6*(charCount+1)*delay` pinned in the target
  layer (wodal `display-scroll.ts` + C++ `display-scroll.h`), cross-checked against an
  `updateScrollText` stepping sim; resume = first think `>=` completion, against VM tick
  `time` (never rAF). **Core async reshape** (`external/mindcraft-lang`): a **bound resolver**
  `AsyncHandle{id, resolve, reject, cancel}` is now the 3rd arg to both async-body paths
  (built from `this.handles`; C++ mirror in `handle-table.h`) - host-binding API only, no
  bytecode/`vm-contract.md` change. `maxHandles` 0->8 (6g seam; 8th cap in the parity
  guard). Additive target trace lines (`...async`, `port display scroll`) under format v1
  (existing goldens byte-unchanged); `VmObserver.onHostActionCallAsync` added. CODAL
  `pendolino3` font ported to the wodal sim only (`src/core/bitmap-font.ts`; device renders
  natively). Deviations from the original design: device resolution = **formula poll**, not
  the `ANIMATION_COMPLETE` bus event (listener didn't fire on hardware - rule stuck after
  one scroll); concurrent scrolls **reject** rather than serialize (LD9 cut the fixed
  queue); the real `BrainRuntime` drives the golden, **closing 6h's cross-VM-oracle item**
  (no separate harness). LD9 pass also removed dead font/delay constants + a defensive heap
  guard. Gate: wodal 139, C++ 252 cases x3 (scroll golden byte-matches, pixel (0,0) lit),
  core 913; hardware-validated (single + repeating scroll). Open follow-up: a managed-string
  scroll test (implementation-complete). New artifact: `docs/specs/tiles/display-scroll.md`.
- **2026-06-16 - Phase 6h accepted** (host-gated + timer-brain hardware regression): the
  async core, a C++ mirror of vm.ts (semantics already core contract). Core `HandleTable`
  (`handle-table.h`, Pool-backed/LD7; `createPending` faults at `maxHandles`;
  resolve/reject/cancel legal only from `Pending`, each enqueues onto an intrusive completed
  queue; new GC root via `enumerateResults`). Opcodes 41 `HOST_CALL_ASYNC` / 45
  `HOST_ACTION_CALL_ASYNC` / 50 `AWAIT` implemented; **43 `ACTION_CALL_ASYNC` left to 6j**
  (still faults via `default:`; the async non-host/bytecode action path, needs a child-fiber
  spawn from inside dispatch, no shipping fixture exercised it yet - 6j implements it, no
  opcode stays deferred). `AWAIT`: resolved->push, rejected/cancelled->throw via the 6e
  path (shared `throwError` + top-of-loop `pendingInjectedThrow`), pending->`AwaitSite` +
  `RunResult::waiting()`; `assertCanSuspend` faults await in a sync action frame. 3c guard
  flipped: `Waiting` now parks the fiber. **Settle = enqueue; `drainCompletedHandles()` in
  `think()` (after tick, before sweep) resumes waiters next round** - accepts an out-of-loop
  settle (the path 6i's CODAL listener needs). Fixed the 6f2 fiber-id divergence (C++ hook
  fibers now a descending inline id space, mirrors TS negatives). Blessed deviation: async
  bodies get the ephemeral stack view, not an owned snapshot (no consumer retains).
  Over-build pass cut 3 dead items. Gate: `async-handles.test.cpp` (9 cases, test caps
  `maxHandles=16`; microbit-v2 stays 0); 247 C++ cases x3, wodal 126; timer-brain reflashed
  (regression). Open: cross-VM async goldens -> folded into 6i.
- **2026-06-16 - Phase 6g accepted** (host build; pure refactor, no reflash): cap
  parameterization - the scheduling/resource caps now come from the device profile, not
  global `constexpr`. New core `DeviceProfileCaps` (8 fields); `FiberScheduler` ctor takes it
  (`spawn`/`runActionHook`/`tick` read `caps_`; no default, no internal `profileId`
  resolution). Host supplies `kMicroBitV2DeviceProfileCaps` (`targets/microbit-v2/abi/
  device-profile.h`); the global `constexpr` caps are deleted (grep-clean); ~40 ctor sites
  threaded via one shared test helper. `profileId` validated in the host (`main.cpp`,
  faithful to TS) -> existing Load-fault loop with new core `LoadError::UnsupportedDeviceProfile`
  = 15 (core names it, host raises it; no new fault machinery). Cap-parity guard: wodal
  `device-profile-caps-vectors` fixture -> C++ `device-profile-caps-parity.test.cpp` asserts
  each cap == the host caps (replaces the literal asserts; 7 caps, `maxHandles`=0 in the
  struct joins the profile + guard in 6i); negative-control proven. LD7/LD9 honored (no
  second profile, no registry, no core default; `kMax*` still runtime guards). Pure
  refactor: 237 C++ cases, goldens byte-match; check.sh x3; wodal 126.
- **2026-06-16 - Phase 6f5 accepted** (hardware-validated): all 8 core sensor/actuator
  host actions (ids 0-7) ported as core, target-agnostic bodies (`cpp/core/runtime/
  host-actions/{actuators,sensors}/` + `core-host-action-env.h` +
  `makeCoreHostActionBindings`); firmware action table = core 8 + microbit 2. Fixed the
  real on-device fault (op-44 core ids resolved null -> ScriptError, pinning page 0).
  BrainRuntime: `requestPageRestart` (cancel fibers -> respawn from entry, no lifecycle
  events), `requestPageChangeByPageId`, `get{Current,Previous}PageId`, `previousPageIndex_`;
  `requestPageChange` mirrors TS (same-page = restart; real change cancels active fibers).
  Timeout = per-callsite managed `List[fireTime,lastTick]` reset on activation, GC-rooted;
  Random = shared `VmRng`; Current/Previous page = borrowed strings; Yield = no-op.
  **Plus a general scheduler-interrupt fix** (`ExecutionState.cancelled`, checked each
  instruction boundary; mirrors TS `runFiber` mid-run `state != RUNNABLE`) - a rule that
  changes/restarts its own page is now interrupted at the next instruction; touches the VM
  dispatch hot path, first exercised here. Deviations: no page-NAME fallback (no name table;
  pageId scan only); out-of-range switch = no-op. Over-build pass cut 4 dead guards. Gate:
  timer-brain/core-host-actions/restart-interrupt fixtures byte-matched + unit tests;
  check.sh x3; wodal 125; hardware-validated (timer brain).
- **2026-06-15 - Phase 6f4 accepted** (host-gated; hardware hex pending the user's
  flash): native device surface, the user-tile milestone - `user-tile-button-display`
  runs end-to-end (byte-exact host parity; patched hex built). Closed the 6f3 CALL-frame
  rule-inheritance prereq (`resolveCalleeRuleFuncId` on the CALL paths). Native-struct rep
  = `Struct(typeId, discriminator-in-handle)`, GC-inert (mixed key: ctx = program-table
  index, device structs = type-atom-id; discriminator = `MicroBitField` id). Registry
  native getters (`native-struct-bindings.h`, closes the 6f1 placeholder); target host-fn
  surface (core `host-function.h` + `RuntimeSurface.hostFunctions`; `isPressed`/
  `setPixelValue` over `DevicePorts`); `ctx` injection at root + `ACTION_CALL` only
  (`pushCallFrame` `injectCtx` flag; closes the 6f2 deferral); host-fn pixel write shares
  the action path's trace line. Scope = exactly the fixture dump. Gate: C++ 234 x3
  (ASan+UBSan), wodal 122. On-device fault discovered in testing (core host actions
  unbound) -> new Phase 6f5. Seam noted: mixed native-typeId collision is far-future only.
- **2026-06-15 - Phase 6f3 accepted** (host build): context-variable host fns 48-51
  (`ctx.brain`/`ctx.rule` `getVariable`/`setVariable` by name), closing the last
  `CoreFuncId` carve-out. `vm.cpp` `HOST_CALL` -> `dispatchContextVariableFunc`. Brain =
  slot-backed (`variableNames` scan -> `ctx.variables`); rule = new
  `ExecutionContext.ruleVarStores` (outer `MapObject` keyed by `ruleFuncId` -> inner
  `MapObject`; both 6c maps reused, lazy, brain-lifetime), read walks `parentRuleFuncId`
  ancestors, write own-map-only; `enumerateRoots` marks it. `currentRuleFuncId` resolved
  on demand (`resolveFrameRuleFuncId`); wired the action-frame `ruleFuncId` inheritance
  (6f2 deferral). Gate: `context-variables` parity fixture (brain + rule + ancestor +
  action-frame inheritance) + 2 GC tests (rule-var store; callSiteSlots - closes 6f2's
  untested marking); check.sh x3; wodal 120. REQUIRED -> 6f4 entry prereq (decided
  2026-06-15): CALL-frame rule inheritance not mirrored (forwarding `ctx` to a non-rule
  helper silently no-ops `ctx.rule` - idiomatic, must close); mirror
  `resolveCalleeRuleFuncId` on the CALL paths before the milestone.
- **2026-06-15 - Phase 6f2 accepted** (host build): bytecode-action execution model,
  C++-only mirror of vm.ts/brain-runtime.ts. `ACTION_CALL` (op 42) via extended
  `pushCallFrame` (actionBinding). NEW `ExecutionContext.callSiteSlots` pad (flat
  `callSiteCount x callSiteSlotStride`, program-derived stride - distinct from the
  host-state cell `callSiteStates`/`present`) for `LOAD/STORE_CALLSITE_VAR`, resolved by
  the per-fiber frame walk (`currentActionBinding`); `enumerateRoots` marks it. Page
  lifecycle: initializer (once) + activation (per-activation) in call-site order +
  deactivation on leave; page-change FSM in `think()` (deactivate old -> activate new
  before time-stamp); hooks via new `FiberScheduler::runActionHook` + `allocFiber`.
  `assertCanSuspend` (sync-action YIELD -> ScriptError). Gate: `action-page-lifecycle` +
  `sync-action-yield` goldens + 2 control-flow unit tests; check.sh x3; core 911, wodal
  119. Deferred: `currentRuleFuncId`/rule inheritance (6f3); host
  `onInitialized`/`onPageExited` + injected-ctx entry (6f4); page restart = no-op.
  Follow-ups (non-blocking): callSiteSlots GC marking untested (fold a GC test into 6f3);
  C++ hook fibers share the positive `nextFiberId_` while TS uses a negative inline id
  space (invisible now; fix before 6h async fixtures combine hooks + faults).
- **2026-06-15 - Phase 6f1 accepted** (host build): struct field-name re-string
  (binary format v2->v3, dump v1->v2) + the type-registry foundation, TS + C++ in
  lockstep. TYPS struct entry now carries `fieldCount` + `(nameStringIdx, fieldId)` pairs
  (-> `ProgramImage::structFields` / TS `ProgramTypeEntry.fields`), so
  `GET_FIELD`/`SET_FIELD`/`STRUCT_COPY_EXCEPT` **resolve** (dynamic `obj[expr]`/`{...x}`
  works; static stays id-based, LD2). New `TypeRegistry` (`type-registry.h`) over
  `ProgramImage` on `RuntimeSurface`; `STRUCT_GET/SET_FIELD` rewritten to
  `read/writeStructFieldById` (native branch present, unused until 6f4). 6c container
  carryover closed (`MapKeys`->`List<key>`, `MapValues`->`List<Any>`,
  `StrSplit`->`List<String>`). Blessed: field-name resolution lives in the program type
  table, not a host registry (truest mirror); container-typeId gate uses a table-free
  structural typeId both VMs encode independently. Gate: new `dynamic-field-access`
  golden + value-vectors 628/628; all fixtures regen v3 (traces unchanged); check.sh x3;
  core 911, wodal 117. `vm-contract.md` updated in-unit.
- **2026-06-14 - Phase 6e accepted** (host build): `TRY`/`END_TRY`/`THROW`/`YIELD`
  (C++ mirror of vm.ts; topmost handler matches, push `Value::error(code)` at
  `catchTarget`, no-handler -> fault, rethrow preserves the `Err` classifier; `YIELD`
  re-enqueues next round). `FiberWorkspace` deleted -> `StackRegionAllocator`
  (`stack-region.h`, a dedicated `SlabAllocator` over the shared arena, list-backing
  realloc): four per-fiber regions grow 8/4/2/1 toward the caps; `ExecutionState` got a
  cap/capacity split + handler region + `allocator` pointer; `pushValue` by value. **The
  last LD7 worst-case reservation is gone.** Caps reconciled to 256/256/64/16: added
  `maxLocalsSize` to the TS `VmConfig` (default 4096) and threaded the four profile caps
  through to `new VM`, root-causing a silent default (the VM had been getting none).
  Dedicated stack slab -> a grow never collects (faults only on arena exhaustion).
  `assertCanSuspend` deferred to 6f2 (needs sync action frames). `vm-contract.md` updated
  in-unit (the external anchor until a repo-local copy exists). Gate: exceptions-yield
  trace golden + `control-flow.test.cpp` + wodal `overflow-caps.spec.ts`; check.sh x3
  (ASan+UBSan); core 911, wodal 116.
- **2026-06-14 - Phase 6d accepted** (host build): all 12 pinned f32 components in
  lockstep (TS + C++ + shared wodal vectors). 10 transcendentals ported from Cephes
  single-precision, rewritten in explicit binary32 (zero `double`; `exp`/`log` use
  loop-based `frexp`/`ldexp` for Luau-safety; `pow` = ECMAScript specials + integer
  binary-exponentiation + `exp(y*log|x|)`, out-of-domain -> NaN). `formatNumber` = Ryu
  f2d (Apache-2.0/Boost) + `String(Number)` grammar, shortest-f32 (Luau-safe pure-number
  limb mulShift); `parseNumber` C++ = integer-only strtod (parseFloat grammar +
  correctly-rounded decimal->f64->f32 via stack BigInt, no `double`), TS unchanged
  (`fround(parseFloat)`). `-ffp-contract=off` per-source on the three `binary32-*.cpp`
  (else arm64 FMA-fuses and diverges; guarded by `multiplyAddRoundsTwice` + test).
  Gate: `pinned-numerics-vectors` 2014 records / `pinned-numerics-parity.test.cpp`
  6270 assertions, negative-control proven; check.sh x3 incl ASan+UBSan. Accepted: C++
  parser's fixed function-local stack scratch (bounded `strtod` working storage, not a
  runtime pool, LD7 N/A). (Implementer's `--gc-sections` dead-builtin "size lever" is
  infeasible - generic firmware is linked before the program is patched in, so no
  builtin can be dropped; closed, see the 6d section.)
- **2026-06-14 - Phase 6c accepted** (host build): `HOST_CALL` dispatch + every
  non-pinned `CoreFuncId` body (`core-host-functions.*`) + managed strings. Built
  **f32-native** (no `double`/64-bit int: native binary32 proven bit-identical to
  "f64 then fround" for `+ - * / % sqrt` over 120M pairs; exact `ToInt32`/`ToUint32`;
  Sterbenz-form `Math.round`; removed a `float`->`int64_t` UB). The kickoff's
  "division needs a wider intermediate" was wrong - no f32 division artifact owed to
  6d. Managed strings = immutable `Pool<StringObject>` + slab byte block; `MapKey`
  byte-content compare unified across borrowed/managed + traced. LCG RNG seed pinned
  to module default `1`. Pinned-deferred ids fault `ScriptError` (contract-conformant;
  no `vm-contract.md` edit). New value-vector gate (628/628) lives in **wodal**, not
  the `external/` submodule. Generalized 6b's pin to a public `Pin` RAII with a
  collect-during-build test (closes 6b's untested-pin gap). Deferred: ASCII-only byte
  string builtins; `kNoTypeIdx` on `MapKeys`/`MapValues`/`StrSplit` results (->6f1).
- **2026-06-14 - Phase 6b accepted** (host build): closed/program-local structs
  (`StructObject` slab sized from TYPS `slotCount`; `STRUCT_*` id-based + deep-copy +
  `STORE_VAR_SLOT` extension; name-keyed degrade = option (a)), `INSTANCE_OF`
  (TYPS-index compare), `CALL`/`CALL_INDIRECT*`/`MAKE_CLOSURE`/`LOAD_CAPTURE`
  (`CapturesObject`); the collector now traces struct slots + captures. Blessed:
  struct-sizing seam (the parity rationale for the degrade); recursive-deep-copy
  GC-safety via a `PinNode`/`DeepCopyRoots` chain (accepted; not deterministically
  test-exercisable). The struct field-name re-stringing follow-up is committed, not
  started.
- **2026-06-14 - Phase 6a accepted** (host build): managed mark-sweep heap
  (`SlabAllocator` segregated free lists, arena-offset handles) + lists/maps +
  `TYPE_CHECK`; collect-on-alloc-fail, `FiberScheduler` is the `GcRoots` source.
  Blessed deviations: map hash index deferred (linear scan); borrowed string-key
  equality by const-pool index (managed-string keys -> content compare in 6c).
- **2026-06-14 - Phase 5c accepted** (both gates hardware-validated): microbit-sim
  per-brain Download + WebUSB Flash via `@microbit/microbit-connection` partial
  flashing (raw dapjs bricks micro:bit V2). **The deploy arc (5a+5b+5c) is complete.**
- **2026-06-13 - Phase 5b accepted** (hardware-validated): target-neutral wodal hex
  patcher + `wodal` CLI (in-repo Intel HEX writer); `firmware-metadata.ts` relocated
  to the neutral `src/mindcraft/`.
- **2026-06-13 - Phase 5a accepted**: on-flash region + boot read-path + dual-artifact
  build; the 4b embedded-program scaffolding retired grep-clean. As-built lean (magic +
  formatVersion only; ABI machinery removed -> Locked Decision 8).
- **2026-06-13 - Phase 4b accepted (PHASE 4 COMPLETE)**: the slice runs on real
  hardware (button A toggles a pixel; the corrupted hex shows the fault face). CODAL
  `device_malloc` panics on OOM -> the VM region is a static `.bss` partition (the
  LD7/CODAL finding).
- **2026-06-13 - Phase 4a accepted**: `cpp/codal/` `HostLoop` + fault-mode policy;
  parity re-confirmed through the real host loop.
- **2026-06-13 - Course correction (Locked Decision 7, dynamic-first memory)**:
  superseded the fixed-capacity-pool design with one `RegionArena` + one `Pool<T>`
  (carve-on-demand); fiber caps removed, `maxFibers` made a runaway guard.
- **2026-06-12 - Phase 3c accepted (PHASE 3 COMPLETE)**: the C++ VM byte-matches the
  TS oracle for the button-display slice (round scheduler + `BrainRuntime` + op 44 +
  trace emitter).
- **2026-06-12 - Phase 3b accepted**: `Value` POD + accessor API; execution state over
  shared operand/locals/frame regions; fiberless dispatch subset; `kMaxLocalsSize`
  added.
- **2026-06-12 - Phase 3a accepted**: observable-trace format v1 (wodal
  `observable-trace.ts`) + the `button-display.press-cycles` golden.
- **2026-06-12 - Phase 2c accepted (PHASE 2 COMPLETE)**: the reader
  (measure-then-fill) + dump v1; all 5 fixtures byte-match the goldens.
- **2026-06-12 - Phase 2b accepted**: `ByteCursor` + `LoadError` + `Result<T,E>`; ABI
  mirror headers value-pinned vs TS; contiguous-arena program image.
- **2026-06-12 - Phase 2a accepted**: canonical dump format v1
  (`brain-program-dump.ts`) + 5 `.mcprogram.dump` goldens.
- **2026-06-12 - Phase 1c accepted**: `cpp/codal/device-port.h` sketch + the
  `check-deps.sh` layering guardrail.
- **2026-06-12 - Phase 1b accepted**: vendored `microbit-v2-samples` @ codal v0.3.4,
  Docker gcc 10.3 pins; C++17 proven on-device.
- **2026-06-12 - Phase 1a accepted**: `cpp/` host tree + CMake presets + `check.sh` +
  `.clang-format` + doctest; C++17 / exceptions-off-in-core foundations.

## Deferred Work

- **Resident runtime / on-device serial loader (deferred indefinitely,
  2026-06-13).** The original Phase 5c - a resident `mindcraft.hex` (VM + ABI +
  VFS + program loader) that accepts a `.mcprogram` over a serial protocol and
  loads it into flash at runtime *without* a full reflash, plus a version-ping
  handshake. **Deferred:** the wodal patcher (Phase 5b) + full-hex flashing
  (download or WebUSB, Phase 5c) cover deployment, so every deploy is a complete
  patched hex and no on-device upload/VFS/serial-protocol/version-ping is needed.
  The on-flash region/header format (Phase 5a) is shaped so a future resident
  loader *could* write it at runtime. Revisit only if runtime program-swap without
  reflash becomes a real requirement.
- **Firmware<->program ABI compatibility machinery is NOT here - it is permanently
  removed, not deferred.** `abiVersion`/`abiDigest`/`firmwareId`, an on-flash format
  v2 carrying ABI fields, a `.mcprogram` ABI envelope, and any patcher/boot
  compatibility check were considered and **removed** - they will never be built.
  This is **not** a deferral with a future trigger; do not look for it here, and do
  not re-introduce it under any guise. See **Locked Decision 8** for the
  prohibition and its review gate.
- **The port-crossing numeric-typing seam (found at Phase 3c; RESOLVED in 6j, 2026-06-17).**
  Origin: port lines crossed a u8-typed `PixelDisplayPort` while the trace was defined "as
  passed to the port, before the device clamps", so fractional / out-of-range coordinate
  args diverged. The 6j as-built resolution **matches CODAL** rather than the earlier u8
  "option B" framing (which was ungrounded): `setPixelValue(int16_t, int16_t, uint8_t)` -
  coords narrow f32->i16, brightness f32->u8 truncate+wrap (no clamp), the **device** does
  the 5x5 matrix early-out, and every call emits a narrowed `port display set-pixel` line.
  In-matrix integers narrow as the identity (existing goldens byte-unchanged). Pinned in
  `docs/specs/contracts/observable-trace.md`. Closed for the **host-action** setPixel path -
  kept here as the seam's history. NOTE: A2 (2026-06-18) found the **host-function** setPixel
  path (user-tile `setPixelValue`) does not honor the same narrowed-trace contract across VMs -
  separate follow-up item below.
- **Shared input-script file format + parsers (deferred from 6j, 2026-06-17; design
  locked).** A line-oriented `mcscript 1` / `tick <ms> [button <name> down|up]` file with a
  host-only C++ parser in `cpp/hostkit` + a TS reader, replacing the hand-mirrored
  press-cycles schedules. Deferred because 6j added no new input-event consumers (its new
  goldens use fixed ticks / page-entered), so `button-display` remains the **sole** consumer
  - the "format for one fixture" Parity Transport itself flagged as over-build, and the dual
  schedule's drift is already self-policed by the byte gate. Build it when a **second**
  input-driven consumer appears.
- **Vector-fixture filename convention cleanup (deferred at the user's request, 2026-06-18).**
  The parity value-vector fixtures use a `-vectors.bin` suffix (`core-host-fn-vectors.bin`,
  `pinned-numerics-vectors.bin`, `device-profile-caps-vectors.bin`,
  `accelerometer-read-vectors.bin`) that overloads the single-word `.bin` against the program
  fixtures' `.mcprogram.bin`. Proposed: a `.vectors.bin` double-extension (parallel to
  `.mcprogram.bin`) applied across **all four** fixtures + their `*-vectors.spec.ts` writers +
  the C++ parity-test decoders, in one cross-cutting rename. Low-risk and self-policing (the
  byte gates fail loudly if a path is missed), but touches every vector family at once, so the
  user wants it done as its own change, not folded into accelerometer A2+. No behavior change.
- **User-tile `setPixelValue` host-function trace does not narrow consistently across VMs
  (found at A2, 2026-06-18).** A real cross-VM parity bug, masked until A2. `observable-trace.md`
  pins the `port display set-pixel` line to the **post-narrowing** value (f32->i16 coords,
  f32->u8 brightness), and the brain **host-action** setPixel path honors it both VMs (the 6j
  `pixel-conversion` golden byte-matches with fractional/out-of-range/negative values). But the
  surface-2 user-tile path - `ctx.microbit.display.setPixelValue`, a host-**function**
  (ts-compiler `HOST_CALL`, the two-compilers split) - diverges: per the A2 implementer wodal
  records the **raw** pre-narrow value while cpp records the narrowed value, so the byte gate
  only holds when `raw == narrowed` (whole, non-negative, 0..255). Invisible until now because
  every prior user-tile setPixel golden used identity-safe values (0/255); A2's reads forced the
  issue and were worked around by injecting integer-clean values (so A2 is a wiring proof, with
  value precision covered by A1's display-free port vectors). **ROOT CAUSE PINPOINTED
  (2026-06-18): wodal's host-function body omits the narrowing wrap.** In
  `packages/wodal/src/targets/microbit-v2/mindcraft/module.ts` the `MicroBitDisplay.setPixelValue`
  function passes `numberArg(args,1..3)` straight to `setPixelValue`, whereas the wodal
  host-**action** (`actions/display-set-pixel.ts`) and the cpp host-function
  (`display-set-pixel-value.h`) both wrap the args in `pixelCoordToPort`/`brightnessToPort`.
  **Fix = wrap the three args** with those helpers (already exported from
  `actions/display-pixel-conversion.ts`); cpp needs no change. **Byte-safe** for all existing
  goldens (identity-safe values narrow to themselves). Add one regression golden pushing a
  fractional/negative/out-of-range value through `ctx.microbit.display.setPixelValue`, byte-matched
  both VMs (or relax A2's `user-tile-accelerometer-reads` to its real non-identity values).
  Optional deeper cleanup (over-build vs. the one-liner, only 2 callers/VM): move narrowing into
  the port boundary (`microbit-display.ts` + cpp `PixelDisplayPort`) so no caller can reintroduce
  it. Does NOT block A3 (the gesture tile is a host-action). Do it before any user-tile golden
  needs to display a non-integer or negative read.
- **`degreesFromRadians` duplicated across C++ test files (minor, found at A2).** The f32
  radians->degrees helper is now copied in `device-port.test.cpp`,
  `accelerometer-read-parity.test.cpp`, and `trace-parity.test.cpp`. Fold into one shared cpp
  test helper when convenient; test-only, no behavior impact.
- **Instruction-level trace mode (deferred from 6j, 2026-06-17; design locked).** Per-
  instruction pc/op/stack-depth via a TS-VM `onInstruction` event + a C++ passive
  `VmObserver::onInstruction` hook + one small golden - the divergence-localizing escalation.
  Deferred because it requires modifying `external/mindcraft-lang` (the reference VM) +
  rebuilding the core dist, and adds a per-instruction hook to the **shipping dispatch hot
  path**, for a debugging aid the gate never named. Build it when a real cross-VM divergence
  needs localizing.
- **Filters (WHEN-side signal modifiers) - core tile-language feature, spec'd not
  scheduled** (`docs/specs/tiles/filters.md`, concept/draft 2026-06-17). A new tile category:
  unary signal transforms on a rule's WHEN side (`invert`/`one-shot`/`latch`/`toggle`, eventually
  more), implemented as **regular intrinsics with full language capability** (the normal
  function machinery, not a closed native set). Core + target-agnostic; touches
  `external/mindcraft-lang`. Does **not** block Phase 7 (sensors ship with their natural
  signal; filters layer on later). Open: the call signature + latch-reset semantics. Revisit
  after the current device-surface peripherals (it benefits from a few sensors landing first).
- **`pause` - core async actuator, registered 2026-06-17, not yet scheduled**
  (`docs/specs/tiles/pause.md`, status proposed). A core (target-agnostic) actuator that
  **suspends the calling fiber for a duration**: async (op 45 + AWAIT), one optional anonymous
  Number = seconds (default 1, fractional allowed); resumes at the first think with VM tick
  `time` >= `start + duration*1000` ms. It is the **first async core host action** (all
  existing core actions are sync) and the **first pure-time-based async resolution** - so it
  needs a core "resume-at-time" handle-resolution path in `think()` (scroll's resolution was a
  device-port poll; pause has no device). Requires `maxHandles > 0` on the profile (microbit-v2
  has 8). Reuses the 6h/6i async machinery; no new opcode.
- Hosted CI (GitHub Actions) for this repo: deferred. "CI" today is the
  scripted local check suites (the TS packages' `check` convention + the C++
  check entry point from Phase 1a); when hosted CI is stood up, it runs the
  same suites unchanged.
- Native-recursion hardening (decoder nesting-depth caps, mandated worklist
  marking, iterative deep-copy): **deliberately deferred until observed as a
  problem**. The port may mirror the TS recursive shapes for the microbit-v2
  slice; implementers may pick iterative shapes where natural, but no proactive
  caps or diagnostics are required. (Reaffirmed at the Phase 2c acceptance:
  the landed CVAL decode recurses without a depth cap, as the TS decoder
  does - adversarial images are not a concern for this project.)
- On-device debugging tooling: re-add `ruleIndex` and function names to the
  serialized payload and a runtime-to-source mapping. The lean payload drops them
  deliberately; a debugger phase re-adds them.
- Additional micro:bit v2 host actions/sensors beyond button A and set-pixel
  (button B, logo touch, accelerometer, display image, etc.), each added to
  the registry -> mirrored-enum -> C++ table path. (**`display.scroll(text)` is
  promoted out of this list** to a scheduled sub-phase, **Phase 6i** (the first
  async capability) - see Phase 6 - the async `display.scroll(text)` on-hardware
  gate, with managed-string scroll layering on 6c.)
- Cross-device simulated medium on hardware (radio), and the matching device
  tiles; sequence after the single-device slice, mirroring the prior plan's
  deferred radio work.
- Additional device targets (a second is hypothetical; whichever board, it slots
  in as a new WODAL device profile + a `cpp/targets/<board>/` peer **on top of the
  already-built `cpp/codal/` board-agnostic layer** - no extraction needed, since
  `cpp/codal/` is built in this work unit - see Multi-Target Structure). A general
  profile-switching build path.
  Confirm CODAL support and target maturity per board when that work starts; a
  non-CODAL board takes the bare-metal or native-host route instead. A very
  constrained board (e.g. the CODAL-supported Arduino Uno, an 8-bit AVR with ~2KB
  RAM) would pressure `cpp/core/`'s value model and region budget (Locked
  Decision 7) far more than the nRF52833 - and the `FiberWorkspace` full-cap
  block especially; treat the core sizing assumptions as nRF52833-class until a
  smaller target is actually scoped.
- The full `wodal` CLI surface (`wodal build`, `deploy`, `build deploy`,
  `build hex`, `flash`) beyond the seams this plan needs.
- **Target self-registration in `packages/wodal` (layering refinement, noted at 5b).**
  Today the neutral `src/mindcraft/device-profile.ts` *imports* the microbit-v2
  module directly, so the neutral layer (and the bundled CLI) physically contain
  microbit code. The flash path, CLI, and JSON-to-binary conversion are all
  profile-driven (a 2nd target = one `WODAL_DEVICE_PROFILES` entry), so this does not
  block anything. True pluggability - targets self-register without the neutral layer
  importing them - is a separate `device-profile.ts` design change, worth doing only
  when a second target is actually scoped.
- Multi-program VFS management and OTA/radio firmware update.
- A byte-stable "build reproduces golden" reproducible-build path (the Phase 4c
  injectable-RNG determinism in core is a latent enabler).
- UF2 packaging as an alternative to `.hex` for drag-and-drop deployment.

## Open Design Questions

Resolved at planning time (Locked Decisions): binary codec home/framing; host ABI
sync strategy; C++ toolchain and core structure; deploy model.

To resolve per-phase before the owning phase starts (recommended defaults noted in
each phase):

- Prep A: COMPLETE - all of these are resolved and shipped in
  `brain-program-binary-codec.ts`. See the Prep A "Wire format (LOCKED)" blocks and
  the code for the authoritative format.
- Prep B (TS side complete): the C++ mirror locations and where parameter defaults
  live. (The parity-test transport is RESOLVED: **field-by-field signature
  comparison**, no digest and no C++-side table dump - Locked Decision 8.)
- Prep C: none - all resolved (`ProfileNumerics` injection, round-based ticks,
  `defaultBudget` = 1000, the `hookBudget` promotion).
- Phase 1a: none open - all locked (doctest; CodeLLDB + committed `.vscode/`;
  the C++ foundations incl. exceptions/RTTI off; "CI" = the local check
  suites). Grounding at kickoff: the C++ standard pin against the
  `codal-microbit-v2` toolchain.
- Phase 1b: the toolchain pins only (gcc version; `codal.json` commits,
  grounded on the real release) - the vendoring + Docker-deps decisions are
  locked.
- Phase 2a: the canonical dump line format (the committed dumps are the
  contract).
- Phase 2b: (RESOLVED - see the Phase Log) decoded-program memory ownership:
  one contiguous read-only image, index/run cross-references, strings
  borrowed from the wire buffer.
- Phase 3a: the observable-trace line format (slice event vocabulary).
- Phase 3b: (RESOLVED - see the Phase Log) caps landed incl. the added
  `kMaxLocalsSize`; flag-bit string reservation; typeId = direct TYPS index;
  the fiber<->stack interface + `StackRegionPool` minimal allocator (grow-on-demand
  stack arena remains Phase 6e's).
- Phase 3c: `maxFibers` sizing (dynamic count cap; round-based scheduling per
  Prep C, no `maxFibersPerTick`); parity-oracle granularity is resolved
  (observable-state now, instruction trace at 6d).
- Phase 4a: pin the device-port interface; the host-loop stamping contract
  (cadence half); the button event model (level-poll recommended); the device
  memory sizing table.
- Phase 4b: the device tick cadence / time source (`system_timer` vs fixed
  loop) realizing 4a's contract; the `cpp/codal/` C++17-glob build touch.
- Phase 5a: (RESOLVED - see the Phase Log) lean header (magic + formatVersion,
  no checksum/length/ABI); metadata = offset/size/magic/formatVersion; offset
  re-extracted from the linked ELF; payload decoded from memory-mapped flash
  (strings zero-copy), only the decoded image in the 32 KiB arena.
- Phase 5b: (RESOLVED) Intel HEX manipulation = a **small in-repo writer** (no
  library), deterministic; the core is environment-agnostic so 5c reuses it. The ABI
  machinery / `firmwareId` / `.mcprogram` envelope are **permanently removed**, not
  open questions and not deferred - see Locked Decision 8. The default-brain
  hex-splice + its ship-or-not product decision are optional post-acceptance.
  (microbit-sim integration moved to 5c.)
- Phase 5c: the package/download UX; the WebUSB/DAPLink library (DAPjs vs
  hand-rolled CMSIS-DAP); the browser-support stance (Chromium-only; file download
  is the fallback); the
  device-pick / progress / error / wrong-board UX.
- Phase 6a: the slab/size-class allocator backing the value-container pools over
  the shared region (mark-sweep strategy and dynamic-first allocation already
  locked - see Locked Decision 7; caps are runtime guards, not pool sizes).
- Phase 6j: the instruction-trace line format and the golden program set
  (including map cases that pin JS-`Map` insertion-order semantics, for forward-
  compatibility with future map-iteration opcodes; the `map` ordered-hashmap layout
  is already locked in Heap And Value Memory Model).
