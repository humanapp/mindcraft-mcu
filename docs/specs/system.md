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
// A System: one shared instance, ticked every think. Defines the movement arbitrator.
const Movement = System({
  name: "movement",
  state: { driveL: 0, driveR: 0, turn: 0 }, // small; brain-var-backed

  init(ctx) {
    // one-time, before the first tick (e.g. stop the motors)
  },

  think(ctx) {
    // runs every think, after rules: blend the latched channels and reissue to the motors
    const left = clamp(this.driveL + this.turn, -100, 100);
    const right = clamp(this.driveR - this.turn, -100, 100);
    ctx.microbit.i2c.writeBuffer(0x10, motorCommand(left, right));
  },

  // methods set latched channels (fire-and-forget):
  drive(left: number, right: number) { this.driveL = left; this.driveR = right; },
  turnBy(amount: number) { this.turn = amount; },
  stop() { this.driveL = 0; this.driveR = 0; this.turn = 0; },
});

// A consuming tile in the SAME module references the System directly - no import:
export const cutebotDrive = Actuator({
  name: "cutebot drive",
  args: [param("left", { type: "number", default: 50 }), param("right", { type: "number", default: 50 })],
  exec(ctx, args) {
    Movement.drive(args.left, args.right); // feeds the one shared System
  },
});
// The brain need not keep firing: think() reissues the blended command every tick
// until a channel changes or stop() is called.
```

**Accessing a System (the import question).** A consumer reaches a System by its symbol. The
**common case is co-location** - define the System and the tiles that feed it in the same module (e.g.
`cutebot.ts` holds `Movement` and the drive/turn/stop tiles), and the tiles reference `Movement`
directly with **no import**. What makes that *shared* rather than per-callsite is that the compiler
recognizes `System(...)` and routes **every** reference to that symbol to the one
System-namespace-backed state - so all callsites coordinate through a single instance, the deliberate
exception to the per-callsite-island rule for module state. **Cross-module export/import is a
first-class, required capability** (this is the production design): a System is defined and
**exported** in one module and **imported** by consumers (`import { Movement } from "./movement"`);
the compiler resolves the imported reference to the one shared System-namespace store, so every
importer and the defining module share the single instance. (Co-located use in the same module also
works without an import.) A System's store is keyed by its **exported symbol identity**, not by its
`name` string - so two distinct Systems never collide and an imported reference resolves to its own
defining store; `name` is metadata (display / debug).

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
- **Methods are fire-and-forget and latched.** A method sets state; the state persists across thinks;
  `think` acts on it each tick. So a `drive` set once persists until changed or stopped - the rule
  need not keep firing.
- **Brain-level system services: page-independent, always running.** A System exists at **brain
  level**, not within a page - it is a system service. `init` runs once at brain startup; `think`
  runs **every think regardless of which page is active**; its state persists across page switches.
  There is **no** page-enter/leave reset - a System is always on (a brain that wants to reset on a
  mode change calls a reset method explicitly; e.g. a held motor command survives a page switch by
  design). Tick order across systems is deterministic (registration order).
- **Both VMs.** The System namespace + the per-think tick are runtime additions that land in **both**
  the wodal oracle and the cpp VM (byte-identical), like the per-rule fiber model; the access lowering
  is a compiler change (one target-unaware place). Goldens exercise a real System.

## First consumers

The design is validated against the two subsystems that motivated it:

- **Movement arbitrator** (the sketch above). State = latched intent channels (drive left/right, turn,
  pivot). Methods `drive` / `turn` / `pivot` / `stop` set channels. `think` blends the live channels
  into final left/right motor speeds and writes them via `ctx` i2c. Fire-and-forget persistence and
  multi-intent blending fall out of latched-state + per-think-blend (the blend is differential-drive
  kinematics; saturate or scale when the sum exceeds the motor range).
- **Edge-tracking sensor sampler.** State = last level + edge flags per pin. `think` samples the gpio
  each tick, diffs against the last sample, and sets edge flags; sensor tiles query the flags. The
  per-think `think` is what guarantees no missed edges (unlike per-callsite polling, which samples only
  when its rule evaluates).

## Open questions

- **`init` vs first-think ordering.** `init` must run before any `think` or method touches the state.
  Resolution: a one-time startup phase runs every registered system's `init` before the first tick.
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
- **Config object shape** - exactly how `state`, `init`, `think`, and methods are declared in the
  `System({...})` config.
- **Determinism + the cpp mirror** - the per-think tick phase and the brain-var-backed lowering must be
  byte-identical across both VMs.
