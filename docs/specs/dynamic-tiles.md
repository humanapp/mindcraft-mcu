# Spec: Dynamic tiles

A library may supply tiles whose existence and shape are not known when the library is written. A
**tile provider** declared in library source publishes a set of **dynamic tiles** derived from live
data - devices attached to a discovery service, endpoints reported by an API, entities listed by a
running subsystem - and the host registers that set in its **tile roster**. Each published tile
carries its own label, icon, documentation, and its own argument grammar, all derived from what the
subsystem reported, while every tile in a family dispatches into one statically compiled body.

This is a generalized capability, not a device feature. Device discovery is its motivating consumer,
but nothing in the mechanism is specific to devices: a provider publishes tiles from whatever data
its library can reach.

The mechanism rests on a separation the platform already makes: a compiled action bundle carries
tile metadata and compiled artifacts as separate collections, and many tiles may bind one action.
Dynamic tiles extend the metadata half to be publishable at runtime; the code half stays statically
compiled, so nothing here requires code generation, on-device compilation, or a second execution
model.

ABI ids: TBD.

## Ownership

- **The host owns the tile roster.** The roster is the host's registry of dynamic tiles currently
  registered. Libraries do not hold it, and it is not project content.
- **The library owns its domain data, and the subsystem it queries is the source of truth.** A
  library does not maintain a durable list of what exists; it reports what the subsystem currently
  says exists.
- **Publication is scoped to a provider.** Each publication replaces that provider's entire
  previously published set. A library re-registers by publishing again; it removes a tile by
  publishing a set that omits it.

Because the subsystem is authoritative, a tile whose backing instance is gone is **cleaned up**: the
host removes it from the roster. The properties that make this safe - deterministic identity and
preserved references - are normative and specified below.

## Authoring surface

**The provider** is a declaration, a sibling of `Sensor`, `Actuator`, and `System`:

- `TileProvider({ name, id? })` - declares a provider identity. `id` is the stable opaque identifier
  assigned on first compile, treated as opaque exactly as for other declarations. The provider
  identity is what scopes a publication's replacement.

**The handler** is an ordinary `Sensor` or `Actuator` declaration marked as a handler. A handler is
the compiled body every tile in its family dispatches into. It is not itself offered in the picker.
A handler declares the full argument vocabulary its family can receive; published tiles select from
that vocabulary.

**Publication** is a call available to library code:

- `publishTiles(ctx, provider, declarations)` - replace `provider`'s published set with
  `declarations`.

Each entry of `declarations` carries:

- `instanceKey` - the identity of the thing this tile represents, supplied by the subsystem. With the
  library coordinate and the provider, it determines the tile id (see Identity).
- `kind` - `sensor` or `actuator`.
- `handler` - a reference to the handler declaration this tile dispatches into. A reference, not a
  name string, per the standing preference for type and binding references over strings.
- `bind` - constant values baked into named handler arguments for this tile. This is how a tile
  carries which instance it addresses without the user seeing or typing it.
- `args` - this tile's own argument grammar, built from the ordinary combinators. Each argument names
  the handler argument it `feeds`.
- `label`, `icon`, `docs`, `tags`, `language`, `outputs` - display and catalog metadata, exactly as
  on a statically declared tile.

## Usage sketch

```ts
// One compiled body backs every published reading tile. It declares the full
// argument vocabulary the family can receive; a published tile uses a subset.
const ReadCapability = Sensor({
  name: "read capability",
  handler: true,
  returnType: "number",
  args: [
    param("device", { type: "string", anonymous: true }),
    param("capability", { type: "string", anonymous: true }),
    optional(param("threshold", { type: "number" })),
  ],
  onExecute(ctx, args) {
    return discovery.read(args.device as string, args.capability as string);
  },
});

const AttachedDevices = TileProvider({ name: "attached devices" });

// Called by the library's own refresh tile, or whenever the library learns the
// subsystem changed. Publishing is a full replacement of this provider's set.
function refreshDeviceTiles(ctx: Context): void {
  const declarations: TileDeclaration[] = [];
  for (const device of discovery.list()) {
    for (const capability of device.capabilities) {
      declarations.push({
        // Identity comes from the device, never from enumeration order.
        instanceKey: `${device.serial}.${capability.id}`,
        kind: "sensor",
        handler: ReadCapability,
        bind: { device: device.serial, capability: capability.id },
        label: `${device.name} ${capability.label}`,
        icon: capability.icon,
        args: capability.comparable ? [optional(param("above", { type: "number", feeds: "threshold" }))] : [],
      });
    }
  }
  publishTiles(ctx, AttachedDevices, declarations);
}
```

In the editor, each published tile appears in the picker as an ordinary tile of its kind, reading
with its own words and offering its own arguments. Nothing distinguishes it from a statically
declared tile at the point of use.

## Semantics

- **A tile id is a pure function of coordinate, provider, and instance key.** Publishing the same
  instance key from the same provider in the same library always produces the same tile id, on every
  machine, in every session, in any order. Nothing about the publication order, the session, the
  connection handle, or the number of instances may enter the id.

  This is the property the whole design rests on, and the failure it prevents is severe: an
  identity derived from enumeration order would silently rebind a saved rule to a different instance
  the moment one instance disappeared, changing what a program does without changing the program.
  An `instanceKey` must therefore be derived from the subsystem's own durable identity for the
  thing - a device serial, a stable resource id - never from an index, a handle, or a mint at
  publication time.

- **An unresolved reference is preserved, never destroyed.** A brain may reference a dynamic tile
  that the roster does not currently hold, because the instance is absent. The reference survives
  loading, editing, and saving of the containing brain byte-identically. No load-time repair, no
  silent drop, no rewrite. A rule holding an unresolved reference renders as an unresolved tile and
  does not compile, and the rest of the brain compiles and runs normally.

- **Restoration is automatic and requires no repair step.** When the instance returns and its
  provider publishes it again, the deterministic id resolves the preserved reference and the rule is
  whole. Removing a tile from the roster is therefore a recoverable act rather than a destructive
  one, which is what makes cleanup on disappearance safe.

- **A reference carries a display hint.** Alongside the tile id, a brain persists the tile's label as
  captured when the reference was authored. The hint is non-authoritative: it never participates in
  resolution, compilation, or identity, and a resolved tile always renders from the roster. Its only
  purpose is that an unresolved reference can render as the thing the author placed rather than as an
  opaque key.

- **A published tile's grammar is free-form over the handler's vocabulary.** Two tiles from one
  provider may differ in argument count, kinds, labels, defaults, and structure. The handler's
  declared argument vocabulary bounds the family: a published tile may feed only arguments the
  handler declares, and handler arguments neither bound nor fed arrive absent under the ordinary
  missing-optional-slot convention. A published argument whose type does not match the handler
  argument it feeds, or that names an argument the handler does not declare, is refused at
  publication with a stable code; it is never silently dropped or coerced.

- **Publication is applied at a quiescent point.** A publication observed while brains are running
  takes effect between thinks, never mid-fiber, in keeping with the single-entry rule that external
  callbacks enqueue and the host loop drains. A library may publish from anywhere its code runs,
  including from inside a running rule.

- **A roster change rides the ordinary catalog-change path.** Applying a publication recompiles what
  the change affects, bumps the catalog revision, and reports invalidated brains, exactly as any
  other change to the registered tile set does. Dynamic tiles introduce no parallel refresh
  mechanism.

- **Publishing where nothing is authoring is a no-op.** The publication call is part of every
  conforming runtime, so a program that calls it links and runs everywhere. Where no authoring
  surface is attached - a flashed program on a device - the call succeeds and registers nothing.

- **A compiled program never depends on the roster.** A published tile compiles to a call into its
  handler with its bound constants baked in. A flashed program therefore carries no reference to the
  roster, the provider, or the publication that produced it, and runs identically whether or not the
  authoring host ever sees the instance again. A handler that addresses an instance no longer present
  at runtime reports absence through the ordinary value-absence path rather than a new error class.

- **Refreshing is the library's choice.** Whether the user can ask for a rescan, and how, is a
  library decision: a library may expose a refresh tile that republishes when placed in a rule, may
  republish from its own periodic logic, or may publish once and never again. The platform does not
  impose a refresh affordance.

- **Two providers never collide.** Provider identity participates in every tile id, so two providers
  in one library, or the same instance key published by two different libraries, produce distinct
  tiles. A single provider publishing one instance key twice in one publication is refused with a
  stable code.

- **Uninstalling a library removes its providers' tiles.** The roster drops them, and references to
  them are preserved under the same rule as any other absent instance, so reinstalling the library
  and republishing restores them.

## Identity and ABI anchors

- Tile id: `tile.<kind>-><coordinate>:dynamic.<kind>.<provider>.<instanceKey>`, paralleling the
  statically declared user-tile form `tile.<kind>-><coordinate>:user.<kind>.<id>`. The coordinate
  namespaces the library, the provider scopes the publication, and the instance key identifies the
  thing.
- Argument tile ids for a published tile's own arguments derive from that tile's id plus the argument
  name, so they inherit the same determinism.
- Provider stable id: assigned on first compile from the declaration, treated as opaque, never edited
  or reused.
- Publication host function id: TBD, appended per the append-only id rule.
- Refusal codes for publication (unknown handler argument, type mismatch, duplicate instance key,
  unknown handler): TBD, allocated in one family.

## First consumer

A device discovery library is the motivating consumer and exercises the mechanism end to end: a
subsystem reports attached devices and their capabilities, one handler per capability class backs
every published tile, per-device parameters and modifiers come from what each device reported, and
unplugging a device removes its tiles while leaving every rule that used them recoverable.

## Open questions

- **Grammar encoding across the runtime boundary.** A published argument grammar is a tree, and
  struct containment cycles are prohibited, so a grammar cannot cross as a self-containing struct.
  The candidates are a flat, parent-indexed node list and a sequence of builder calls. Undecided.
- **Roster scope.** Whether one roster serves the host, or one exists per open project, and what a
  provider in a library installed by two open projects publishes into.
- **Provider invocation by the host.** Whether the host ever invokes a provider itself - at session
  start, on library install - or whether publication is exclusively library-driven.
- **Display hint storage.** Whether the hint lives on each reference or once per brain in a side
  table keyed by tile id.
- **Localization.** Published labels come from a subsystem and are not localizable through the
  catalog. Whether providers may supply localized forms, or published labels are permanently
  pass-through.
- **Outputs on published tiles.** Whether a published tile may declare outputs whose identities the
  handler does not statically declare, given that output identity is `(type, name)` and shared by
  construction.
- **Trust.** A library that publishes tiles can name and shape them freely. Whether any constraint on
  published metadata is warranted, and what it would prevent.
</content>
</invoke>
