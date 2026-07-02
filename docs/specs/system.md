# Spec: System (user-code shared singleton, ECS-style)

A **System** is a user-code singleton: one shared instance, visible to every action callsite in a
brain, with persistent state, a one-time `init`, a per-think `think`, and methods. The name follows
ECS terminology - a System is logic that runs each tick over shared state. It is the program-wide,
runtime-ticked counterpart to module-level user state, which is **per-callsite** (each call site an
isolated island; see the verified state model). A System is the home for stateful subsystems that span
callsites and must run every think - e.g. a movement arbitrator that blends drive/turn/pivot intents,
or an edge-tracking sensor sampler.

This is a brain-language / runtime feature (ts-compiler + core runtime), not a device peripheral.

## Why it exists

Two gaps in user code today:
- Module-level state is **per-callsite** (each call site an isolated island); there is no shared
  mutable object across callsites except a brain variable, which is awkward to use directly.
- There is **no per-think hook** - nothing runs each think independent of a rule firing, so a
  subsystem cannot reissue a held command or sample a sensor while idle.

A System closes both: shared state in a dedicated internal namespace (collision-proof, not
brain-code-visible) plus a runtime per-think tick.

## Authoring surface

Defined like `SensorConfig` / `ActuatorConfig`:
- `state` - the initial state shape: a plain object of VM-representable values (numbers, strings,
  booleans, small structs). Kept small (see Semantics).
- `init(ctx)` - runs once, at brain startup, before any rule or `think`.
- `think(ctx)` - runs every think, after rule evaluation. Reads/writes state; performs device I/O via
  `ctx`.
- methods - ordinary methods that read/write state (via `this`), called from any action's body.

## Usage sketch

```ts
// A System: one shared instance, ticked every think. The movement arbitrator
// (full design: docs/specs/movement.md) collects per-think wheel influences.
const Movement = System({
  name: "movement",
  state: { accL: 0, accR: 0 }, // this think's accumulated influences

  init(ctx) {
    // one-time, before the first tick (e.g. stop the motors)
  },

  think(ctx) {
    // runs every think, after rules: blend this think's influences and drive
    // the chassis; no influences -> (0, 0) -> the robot stops (decay on silence)
    const left = clamp(this.accL, -100, 100);
    const right = clamp(this.accR, -100, 100);
    ctx.microbit.i2c.writeBuffer(0x10, motorCommand(left, right));
    this.accL = 0; // next think starts silent
    this.accR = 0;
  },

  // methods add influences; rules re-emit every frame they fire:
  drive(speed: number) { this.accL += speed; this.accR += speed; },
  pivot(rate: number) { this.accL += rate; this.accR -= rate; },
});

// A consuming tile (its own file - tile authoring is one default-export tile
// per file) imports the System; every importer shares the one instance:
import { Movement } from "./movement";
export default Actuator({
  name: "cutebot drive",
  args: [param("speed", { type: "number", default: 50 })],
  exec(ctx, args) {
    Movement.drive(args.speed); // one influence into the one shared System
  },
});
// Rules keep the robot moving by firing; when no rule commands movement,
// think() sees no influences and the robot stops.
```

**Accessing a System (the import question).** A consumer reaches a System by its symbol. Because
tile authoring is **one default-export tile per file**, the common multi-tile shape is: the System
lives in its own module (exported), and each tile file **imports** it - every importer shares the
single instance. Co-located reference (no import) also works where a System sits in the same file
as its one default-export tile. What makes either *shared* rather than per-callsite is that the
compiler recognizes `System(...)` and routes **every** reference to that symbol to the one
System-namespace-backed state - so all callsites coordinate through a single instance, the deliberate
exception to the per-callsite-island rule for module state. **Cross-module export/import is a
first-class, required capability** (this is the production design): a System is defined and
**exported** in one module and **imported** by consumers (`import { Movement } from "./movement"`);
the compiler resolves the imported reference to the one shared System-namespace store, so every
importer and the defining module share the single instance. (Co-located use in the same module also
works without an import.) A System's store is keyed by its **exported symbol identity**, not by its
`name` string - so two distinct Systems never collide and an imported reference resolves to its own
defining store; `name` is metadata (display / debug).

A System's `init` / `think` / method bodies may reference the module-level **`const` values** and
**`function`s** of their defining module (e.g. a `clamp` helper or a `PIN` constant declared beside the
System). This follows the module-scope model user code commits to:

- **`const` / `function` at module scope are program-global and shared** - one value / one function for
  the whole brain, visible wherever they are in lexical scope, System bodies included. They resolve
  the same whether the System is used co-located or imported cross-module; a consumer in another module
  needs no re-declaration or import of those helpers.
- **`let` / `var` at module scope is per-tile-instance mutable state** (each callsite an isolated
  island; see the verified state model). A brain-global System has no single tile instance whose `let`
  to read, so **referencing a module-level `let` from a System is a compile error** - directing the
  author to a System field (for shared mutable state) or a `const` (for a shared constant), never a
  silent fault.
- **`System({...})` is the shared-mutable-state primitive.** One-liner: `const`/`function` are shared;
  `let` is per-tile-instance; if you want shared mutable state, that is what a System is for.

## Semantics

- **One shared instance per brain.** Every callsite sees the same state.
- **State lives in a dedicated, internal System namespace - NOT the brain-variable pool.** The
  brain-var pool is shared with brain-editor / brain-code variables (verified), so a System named
  `movement` there would risk colliding with a user's brain variable. Instead, System state lives in
  its own namespace - the same way callsite vars are a separate namespace from brain vars - which is
  **collision-proof by construction and not reachable from brain code** (Systems have no tiles and no
  brain-var surface; they are user-code-internal). The compiler lowers method/state access to
  load-mutate-store on that namespace - the **same transparent backing it already applies to a
  module-level `let`** (which it backs to a callsite var), re-aimed at the System store. Methods
  already compile to struct-receiver functions, so `Movement.drive(...)` is a function over the state
  struct.
- **No per-method copy cost.** The brain-variable deep-copy-on-store is a brain-language (by-value
  assignment) semantic, not a universal VM rule. The dedicated System namespace is an internal store
  we define, so it holds state **by reference and mutates in place** - `this.driveL = left` is an
  in-place field write, no copy. State size is therefore not copy-bound.
- **State persists across thinks; each System chooses its own state pattern.** A method mutates
  state; the state persists until the System itself changes it; `think` runs each tick over it. On
  that substrate a System may LATCH (a value set once holds until changed - the line sensor's
  `onLine` levels) or accumulate PER-THINK (state that `think` consumes and clears each tick - the
  movement arbitrator's influence accumulators). Both are user-code choices, not substrate behavior.
- **Brain-level system services: page-independent, always running.** A System exists at **brain
  level**, not within a page - it is a system service. `init` runs once at brain startup; `think`
  runs **every think regardless of which page is active**; its state persists across page switches.
  There is **no** page-enter/leave reset - a System is always on, and its state crosses page
  switches untouched (e.g. the line sensor's levels remain valid through a switch; the movement
  arbitrator keeps ticking and stops the robot simply because the old page's rules stop emitting).
  Tick order across systems is deterministic (registration order).
- **Both VMs.** The System namespace + the per-think tick are runtime additions that land in **both**
  the wodal oracle and the cpp VM (byte-identical), like the per-rule fiber model; the access lowering
  is a compiler change (one target-unaware place). Goldens exercise a real System.
- **Methods behave like native methods over the shared state.** Within `init` / `think` / a method,
  `this` is the System instance: sibling calls (`think` calling `this.blend()`, `stop()` calling
  `this.reset()`, including mutual/recursive), field reads/writes, and in-place field operators
  (`this.field++`, `--this.field`, `this.field += n`) all work. External calls (`Movement.drive(...)`)
  and field reads work too. The one constraint: a method must be **called, not read as a value** -
  `const f = Movement.drive` (or `this.drive`) is a diagnostic, not a silent nil.

## ABI anchors

- Opcodes: `LOAD_SYSTEM_VAR` = 12, `STORE_SYSTEM_VAR` = 13 (the Variables band; operand schema
  `[UVAR]` = the System-store slot). `STORE_SYSTEM_VAR` writes **by reference** (no deep-copy), so a
  method's `this.field = x` mutates in place; `LOAD_SYSTEM_VAR` of an unwritten/out-of-range slot
  yields NIL; the store grows lazily.
- Store: a brain-global `systemStore` on the runtime, separate from `variables`/`variableNames`,
  reached via the `ExecutionContext` accessors `get/setSystemVarBySlot`.
- Registry: `Program.systems: List<SystemRegistration>`, where
  `SystemRegistration = { name, storeSlot, initFuncId?, thinkFuncId? }`.
- Store key (System identity): the exported-symbol identity `"<declaring-file>::<binding-name>"` -
  identical in the defining and importing modules. The linker maps each identity to one global store
  slot and registers each System once (first artifact wins), remapping every artifact's
  LOAD/STORE_SYSTEM_VAR operands local -> global.
- Runtime phases: startup-init runs each `initFuncId` once, in registration order, before the first
  page activates (the init wrapper builds the initial state into the slot, then runs user `init`);
  the per-think tick runs each `thinkFuncId` after the scheduler tick and before gc, every think,
  page-independent. Both run the user function in a spawned, run-to-completion (non-suspendable)
  fiber; `ctx` is passed only when the user function declares the parameter.
- Codec: `Program.systems` serializes as an optional `SYST` section (presence bit 8, after `RANC`,
  before `PAGE`), byte-identical in the TS serializer and the cpp reader. Per record: a flags byte
  (bit0 = `initFuncId` present, bit1 = `thinkFuncId` present), `varuint(name)` (string-table index),
  `varuint(storeSlot)`, then the present func ids. On the cpp managed heap the `systemStore` is a GC
  root (the oracle relies on JS GC; rooting is the cpp-side mirror, not a behavior difference).

## Scope: per-brain inclusion (reachability, not project-global)

In a multi-brain project, a System is **not** automatically included in every brain. A System is
included in a brain - its `init` runs, its `think` ticks, its store exists - **iff the brain reaches
it**: the brain uses a tile (or Device-API code) that references the System. Using the tile is the
opt-in; it is per-System granular (a brain that uses only a line-sensor tile gets the edge-sensor
System, not `Movement`) and automatic (no separate enable toggle). This rides the brain compiler's
existing **tree-shaking**: a System's registration (what the runtime inits + ticks) is emitted into a
brain's program only when the System is reachable from that brain's used code - **per brain, never
project-global**. A brain that references no code touching a System never inits or ticks it.

## First consumers

The design is validated against the two subsystems that motivated it:

- **Movement arbitrator** (`docs/specs/movement.md`). Rules emit wheel-pair influences
  (`drive` / `turn` / `pivot`) every frame they fire; state = this think's influence accumulators
  plus output/config (smoothing, drift). `think` sums the influences, applies the drift gain,
  scale-preserving saturation, and smoothing, and writes the wheels via `ctx` i2c every think -
  no influences means the robot stops (decay on silence). Exercises per-think state consumption,
  multi-callsite blending, and the Device-API config surface (`setSmoothing` / `setDrift`).
- **Edge-tracking sensor sampler.** State = last level + edge flags per pin. `think` samples the gpio
  each tick, diffs against the last sample, and sets edge flags; sensor tiles query the flags. The
  per-think `think` is what guarantees no missed edges (unlike per-callsite polling, which samples only
  when its rule evaluates).

## Open questions

- ~~**`init` vs first-think ordering.**~~ RESOLVED: `init` runs before any `think` or method touches
  the state. A one-time startup-init phase runs every registered System's `init` once (registration
  order) before the first page activates - ahead of any `think` tick. Built + verified on both VMs.
- ~~**Page scope of `think`.**~~ RESOLVED: Systems are **page-independent brain-level services** -
  `think` runs every think regardless of the active page, state persists across page switches, no
  page-enter/leave reset. (See Semantics.)
- ~~**Cross-module access.**~~ RESOLVED: export/import is a required capability; store keyed by the
  exported symbol identity. (See the access note.)
- ~~**State-copy cost.**~~ RESOLVED by the dedicated namespace: System state mutates in place (no
  brain-var deep-copy), so there is no per-method copy cost. Impl choice (settle in the impl plan): a
  new `LOAD/STORE_SYSTEM_VAR` opcode family + store (cleanest separate namespace), or reserved
  callsite-var slots (less new machinery).
- ~~**Namespace / collision.**~~ RESOLVED: dedicated internal System namespace, separate from the
  (verified-shared) brain-variable pool - collision-proof and not brain-code-reachable.
- ~~**Config object shape.**~~ RESOLVED: `const X = System({ name, state, init?(ctx), think?(ctx),
  ...methods })` - methods top-level, `this` bound to the state shape (`ThisType<S>`); the construct
  returns `S & M` so external `X.field` / `X.method(...)` typecheck. A module-level binding, co-located
  or `export`ed.
- ~~**Determinism + the cpp mirror.**~~ RESOLVED: both VMs byte-match through the codec. The `SYST`
  codec section serializes `Program.systems`; the cpp VM mirrors opcodes 12/13, the non-copying
  brain-global `systemStore` (GC-rooted), and the startup-init + per-think phases. A real-compiled
  cross-VM fixture (`user-tile-system`) compiles -> serializes -> deserializes -> byte-matches the
  trace on both VMs.
