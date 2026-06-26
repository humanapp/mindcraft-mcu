# Spec: display draw functions

A device's display is a single shared pixel grid. This spec is the home for the **family of
functions that put content on it** - their shared arbitration model, the async-draw pattern they
follow, and the `Image` type they consume. The family model and `Image` type are
**target-agnostic**; how a pixel value is interpreted and how big the display is are **defined by
the target** (see Target parameterization). The first - and currently only - target is
micro:bit-v2, specified in its own section. The first members are **scroll text** and **draw
image**. Per-pixel reads/writes are surface 2 (`microbit-context.md`).

Status: evolving family spec. The settled design is below; unresolved items are collected under
**Open questions** at the end.

## Target parameterization

The cross-target parts of this spec - the draw-family model, the display lease, the async-draw
pattern, and the `Image` structure - do not assume a pixel meaning or a display size. Two things
are **the target's to define**, not this layer's:

- **Display dimensions.** The target provides the display width and height. Draw functions and
  `Image` sizing read them; this spec hardcodes no size.
- **Pixel-value interpretation.** A pixel is an integer. What it *means*, its valid range, and
  how an out-of-range value narrows are the target's. On micro:bit a pixel is a grayscale
  brightness; another target may interpret it as a palette index or a packed color.
- **Editor presentation (surface 3, off the parity path).** How a stored pixel byte is shown in an
  image editor, and which values are paintable, are the target's. The editor is one general palette
  pixel editor driven by a **target-provided descriptor**: a `renderPixel(value 0..255) -> color`
  total function (micro:bit = a black->red brightness gradient; a palette target = `palette[value]`)
  and an `editPalette` of selectable `{ value, swatch }` entries (micro:bit = 2 entries `{0, 255}`,
  presented as click-to-toggle; a 16-color target = its 16 custom colors, painted as the current
  selection). The render palette and the edit palette are independent: `renderPixel` covers the full
  storable range (so a brightness authored in a literal still displays), while `editPalette` may be a
  subset (binary today; a brightness ramp later) with no model change. micro:bit is thus the
  degenerate (2-swatch) case of the same editor a palette target uses.

The cross-target layer therefore treats pixel values as **opaque integers** and reads the
display dimensions from the target. The seam exists so a different display - for example a
larger, palette-based Arcade screen (a small jump from micro:bit) - can be added as a new target
without changing the family model or the `Image` type. Only the micro:bit-v2 interpretation is
specified and built here; no other interpretation is implemented until such a target is scoped.

## The display as a shared resource

- One display per device: a pixel grid of target-provided dimensions, with target-interpreted
  pixel values (see Target parameterization).
- The display holds whatever was last drawn; a draw persists until the next draw overwrites it.
  There is no implicit clear.
- Draw functions come in two stances:
  - **Instantaneous** - a write with no duration (a per-pixel poke, or a full-frame paste with
    no hold). A sync host-function. `setPixelValue` (surface 2) is the example.
  - **Temporal** - a draw that holds the display for a stated duration. An async dispatch +
    `AWAIT`; the dispatching fiber parks until it completes. It reaches the runtime as op 45
    `HOST_ACTION_CALL_ASYNC` from a surface-1 tile / brain action, or as op 41 `HOST_CALL_ASYNC`
    from the surface-2 host-function (`ctx.microbit.display.drawImage`); both return an awaited
    handle and share the same lease.

## Surfaces

The display family is delivered on the three standard surfaces:

- **Surface 1 - brain tiles.** The draw actuators (`scroll text`, `draw image`), a
  **`create an image`** factory tile that opens the image editor and produces an `Image` value,
  and **built-in image literal tiles** (a target-defined icon set - see the micro:bit section).
- **Surface 2 - TS user-code API.** `ctx.microbit.display` (registry: `microbit-context.md`)
  gains `drawImage(image)` alongside the existing per-pixel reads/writes. The `Image` type, the
  `image(...)` literal builder, and the built-in icons (as named `Image` constants) are delivered to
  TS user code through a **target-injected TS stdlib** - ordinary source compiled with the user's
  program, not compiler-folded constants (the compiler stays target-unaware). The same facility can
  later carry a shared, target-agnostic core stdlib.
- **Surface 3 - image editing.** An image editor for the `Image` value, in both authoring
  environments: in the brain editor, the `create an image` **image factory** (a custom literal
  editor); in VS Code for Web, a **CodeLens** over image literals that opens a webview image
  editor (see Image editing in VS Code for Web). Both edit the same `Image`; both are editor-only
  - the compiled `Image` value is on the parity path, the editor UI is not.

## Arbitration: the display lease

A draw with a positive duration acquires a **lease** on the display for that duration. The lease
is the arbitration mechanism when more than one rule wants the display.

- The lease is a **target-layer concept resolved against VM tick time** - deterministic and
  parity-matchable - **not** a device-driver busy/animation state. Completion is a pure function
  of the draw's inputs (each member defines its formula), settled in the host-loop drain when VM
  tick time reaches it. A device-driver animation-complete event is never the completion signal
  (it is non-deterministic and, on micro:bit's CODAL, does not reliably fire on hardware).
- The dispatching rule `AWAIT`s the lease and resumes on the first `think()` past completion;
  while parked it does not re-fire.
- **A draw dispatched while a lease is held is silently dropped**: its paste is discarded (the
  display is unchanged), and its handle resolves immediately, so the dispatching fiber continues
  without blocking or erroring. There is no queue or serialization, and the loser does not
  acquire or extend the lease.
- **The `immediately` modifier preempts the lease.** A scroll or draw carrying the `immediately`
  modifier (a surface-1 tile on the actuator) cancels the held lease before running: the preempted
  operation's handle is resolved (its awaiting rule resumes as if it had finished, never faulting)
  and the modified operation takes the display at once. On device the preempt also stops CODAL's
  in-flight scroll animation; CODAL's animation code holds no locks and runs on the cooperative
  scheduler, so stopping and restarting it within one `think()` is race-free.
- The lease spans the **whole temporal family**: a scroll lease blocks a draw-image and vice
  versa, because they share one physical display.
- A **zero-duration draw takes no lease** - it paints and completes immediately (see draw image).
- **Instantaneous writes (`setPixelValue`) are not gated by the lease** - they apply immediately,
  on device and in the sim.
- The lease governs the await and the arbitration; it does **not** auto-clear the display when it
  expires. The drawn content persists until the next draw.

Because rule execution order within a round is deterministic, arbitration is deterministic: the
first positive-duration draw in round order acquires the lease; later draws dispatched during the
lease are silently dropped (each completes immediately with its paste discarded).

## Async-draw pattern (shared by all temporal members)

- Dispatched as op 45 `HOST_ACTION_CALL_ASYNC` (a surface-1 tile / brain action) or op 41
  `HOST_CALL_ASYNC` (the surface-2 host-function), each returning a handle the dispatcher `AWAIT`s -
  the same machinery as `pause`. (A handle resolved at dispatch does not suspend the fiber, which is
  what makes a zero-duration or dropped draw fire-and-forget.)
- The visible effect is produced per the member's nature (an animation across the duration, or a
  one-shot paste held for the duration). On device this maps to a target driver call; in the sim
  to the wodal display model; the two are byte-matched via the observable trace.
- Completion = the member's formula vs VM tick time. The device-driver completion event is not
  used. A temporal draw consumes an async handle from the profile's `maxHandles` budget (a
  runtime guard, never a pool size).

## Member: scroll text

- An async actuator placed in `do`. One optional, anonymous **String** to scroll across the
  display; when the slot is absent or nil, a target default string is scrolled.
- Clears the display, then scrolls the text across it, right to left; the text scrolls in from a
  blank display so any prior content (an earlier draw) does not linger under the animation. The
  rule awaits the animation and parks until it completes (it does not re-fire while parked). On
  completion the handle resolves and the rule resumes on the following `think()`.
- Holds a display lease for the scroll duration; a concurrent draw is silently dropped per the
  lease policy. The optional **`immediately`** modifier preempts the current lease so the scroll
  starts at once (see the lease section).
- Completion: `start + (displayWidth + spacing) * (charCount + 1) * delay` ms against VM tick
  time, where `displayWidth` is the target's, `spacing` is 1, `charCount` is the text's UTF-16
  code-unit length, and the `+ 1` is the trailing blank cycle that clears the last character. The
  clock is VM logical tick time, never wall-clock or animation-frame time.
- Device and trace: the actuator calls a display scroll-text port method; the wodal sim and the
  device port both run the CODAL-matching animation, driven from logical time. The trace emits
  `port display scroll "<bytes>"` when the scroll crosses the display port, plus the async
  `action <id> site <callSiteId> args <argc> <value>... async` dispatch line (the trailing
  `async` marks a handle return rather than a value).

## Member: draw image

- An async actuator placed in `do`. Renders a full `Image` to the display at once.
- **Planned: multiple anonymous `Image` arguments.** `draw image` accepts one or more anonymous
  `Image`s (a `repeated` slot); with more than one, it displays each in sequence, **holding each
  for the `duration`** before advancing (one lease spanning the whole sequence; total =
  imageCount x `duration`). The shipped cut takes a single `Image`; the repeated slot is the
  planned extension.
- Arguments: an optional anonymous **`Image`** to draw (from a `create an image` factory tile, a
  built-in image tile, or an `Image` variable), plus an optional, **named** **duration** Number in
  **seconds** (the `Image` is the bare anonymous slot, like `scroll` text; the duration is a named
  slot). The actuator converts the seconds duration to the lease's milliseconds (truncated).
  - **Image default:** when the `Image` slot is absent or nil, a **target default image** is drawn.
    On micro:bit-v2 that is a smiley face (the target's built-in default image).
  - **Duration default:** when the duration slot is absent or nil, the draw holds for **1 second**.
  - The optional **`immediately`** modifier preempts the current display lease so the draw runs at
    once (see the lease section).
- At dispatch the image is pasted onto the display **top-left aligned** (the image's `(0,0)` at
  the display's `(0,0)`) and **clipped to the display dimensions**. An image larger than the
  display is **not** an error - off-screen pixels are clipped. (The fixed `(0,0)` offset is the
  first cut; panning an oversize image is a future image-scroll / animate concern.) What follows
  depends on the duration:
  - **duration 0 - fire-and-forget.** The paste lands and the action completes immediately; the
    fiber continues without suspending and **no lease is taken**. (Only an explicit `0` is
    fire-and-forget; an omitted duration uses the 1 second default below.)
  - **duration > 0 (including the 1 second default) - lock and sleep.** The draw holds a display
    lease for the duration and the fiber sleeps until it elapses, then continues. The display is
    **not** cleared afterward - the image persists until the next draw.

  Duration is non-negative; there is no negative-duration case.
- Completion: `start + duration * 1000` ms against VM tick time (the duration is in seconds; for an
  explicit duration 0 this is the dispatch instant, so the awaited handle is already resolved and
  the fiber does not park).
- The paste happens at dispatch with **no device-driver hold timer**; the lease and completion
  are the VM's. Forwarding a driver-side `delay` on top of the VM lease would double-gate on two
  clocks and could silently drop a write the VM allowed.
- **Transparency (under consideration):** the paste defaults to **overwrite** (every image pixel
  written, transparent pixels as brightness 0); a transparent / overlay mode (a surface-1
  modifier, a surface-2 flag) would **skip** transparent pixels to composite over existing
  content. See Image literals and transparency.

## The `Image` type

- An `Image` is a **registered Struct type** - `{ width, height, pixels }` - not a new VM
  primitive. It reuses the existing struct and literal machinery (both VMs already implement
  structs), so the runtime needs nothing new. The struct stores **opaque integer pixel values**
  plus the dimensions; pixel interpretation is the target's (Target parameterization).
- `pixels` is a **`Buffer`** (the core raw-byte value type): one byte per pixel, row-major,
  values 0-255 (the `codal::ImageData` layout, minus its ref-count header). The values are
  target-interpreted (grayscale on micro:bit). This matches how both CODAL and MakeCode store
  images - a byte buffer, not a list of values.
- **Any dimensions.** The `Image` size is not constrained to the display; `draw image` clips an
  oversize image to the display (above). A target's built-in images are typically display-sized,
  but the type permits any width and height.
- **Instances are literals.** An `Image` value is created by the `create an image` image factory
  (surface 1), whose image editor (surface 3) builds the struct; the literal is baked into
  the brain program as a constant and passed to `draw image`. This mirrors the existing `Vector2`
  pattern - a registered struct type plus a custom literal editor (a `CustomLiteralType` whose
  `renderInputFields` is the editor), registered against the core factory API
  (`BrainTileFactoryDef` / `api.defineType` / `registerLiteralFactoryTileDef`).
- The struct *shape* is target-agnostic, but the *type registration* is **target-side** (a
  micro:bit-v2 type), because pixel interpretation is target-owned.

## Image literals and transparency (under consideration)

A readable text literal for authoring an `Image` in TS user code (surface 2), the inline
counterpart to the surface-3 image editor, modeled on MakeCode's `img` literal. This is a
working sketch, not settled.

```
const arrow = image(`
. . f . .
. f f f .
f . f . f
. . f . .
. . f . .
`)
```

`.` is an unset/transparent pixel; a hex digit `0`-`f` is a brightness level. Reflections:

- **The encoding is target-owned, like pixel interpretation - this answers the palette-scaling
  worry.** The literal maps characters to the target's opaque pixel integers; the hex-brightness
  mapping is micro:bit's. A target with a larger palette (>16) defines its own encoding (more
  characters per pixel, or a different scheme) on the same seam that owns pixel interpretation.
  One text encoding never has to scale to every target - the 16-value hex form is simply
  micro:bit's, and a future target brings its own.

- **16 levels is the coarse path; the editor is the fine path.** A hex digit gives 16 brightness
  steps, mapped to the type's full 0-255 (`n * 17`, so `f` -> 255). The image editor authors
  arbitrary 0-255 values; both produce the same `Image` struct.

- **The transparency *representation* and the draw's transparency *mode* land together (deferred).**
  - *Representation:* the `Image` records which pixels are unset/transparent (a mask, or a
    sentinel distinct from brightness 0). Storing this keeps `.` and `0` meaningfully different
    (transparent vs explicit-off), which matters on a grayscale display where 0 is a real
    brightness. Because pixels are full 0-255 bytes, a distinct "transparent" needs a mask buffer or
    a widened representation - a structural change to the `Image` struct.
  - *Mode (a draw-time choice):* `draw image` defaults to **overwrite** (transparent pixels
    written as brightness 0 - a full-frame replace); a **transparent / overlay mode** (a
    surface-1 modifier, a surface-2 flag) **skips** transparent pixels, compositing over existing
    content. This is CODAL `paste`'s `alpha`.
  - **They ship together, not the representation first.** Storing a representation with no consumer
    until the mode exists buys nothing (and forces an `Image` struct change early), so the first
    `image()` cut maps `.` to brightness 0 (no transparent/explicit-0 distinction); the
    representation and the mode arrive in the same later cut. Image literals are recompiled from
    their source text every build, so adding the distinction later costs no migration.

- **Syntax - settled: `image(` backtick `)`, a function over a multiline backtick string** (the form
  above). It is an ordinary exported function in the target's TS stdlib that parses the art and
  returns an `Image` struct - so authoring is plain, inspectable, forkable TS, and end users
  copy-paste the same `image(...)` call to define their own icons. The MakeCode-style tagged template
  (`img` backtick) was considered and **rejected**: tagged templates have no compiler lowering and
  would need a tag-name resolution registry, a large net-new compiler change, whereas a call over a
  template string needs no compiler change (template strings are already supported). Either form
  would build an ordinary `Image` struct - no new VM machinery - but the function form costs nothing
  in the compiler.

- **Format (sketch):** spaces/tabs are insignificant separators (for visual alignment), newlines
  delimit rows, every other character is a pixel; leading/trailing blank lines ignored. Ragged
  rows either error or pad with transparent (a friendliness call). The built-in image set can be
  defined with this same form internally.

## Image editing in VS Code for Web (CodeLens)

TS user code is authored in **VS Code for Web** via the existing Mindcraft extension
(`external/mindcraft-lang/apps/vscode-extension`, a browser web extension). An image literal in a
TS file gets an in-editor pixel editor through a **CodeLens** - the always-visible affordance the
construct deserves, since VS Code does not expose a clickable gutter widget to extensions.

- **CodeLens.** A provider places an "edit image" lens on each image literal, following the
  extension's existing CodeLens pattern (its `mindcraft.json` lock/unlock provider is the model:
  register a provider, bind the lens to a command, re-render via `onDidChangeCodeLenses`).
  Clicking the lens opens the editor.
- **The editor is a webview** (the extension's first), so it must be **browser-only** - Canvas /
  DOM, no Node APIs - and communicate with the extension host by message passing
  (`postMessage` / `onDidReceiveMessage`). It seeds from the literal's current image and posts
  back the edited image.
- **The literal text is the source of truth** - there is no separate asset file. Saving
  round-trips the literal: the literal's backtick-string range is replaced in the document (a
  `WorkspaceEdit` on the open document, or the extension's bridge full-file write through the
  `mindcraft://` filesystem). This authors the same `Image` value as the surface-1 image editor.
- **Literal locations come from the compiler, not regex.** The bridge compiler has the AST and
  reports the source ranges of editable asset literals; the extension places the lenses from
  those. This is a **general asset-literal-location facility**, not image-specific: each location
  is tagged by asset **kind** (image now, the planned sound-effect editor next), so one CodeLens
  mechanism plus a per-kind editor registry serves every asset type - adding a kind is additive,
  no new message per type.
- **How an editable literal is identified, with a target-unaware compiler.** The compiler must not
  know the name `image`, and the extension must not know about targets. The association runs through
  a **kind string** across three independent parties:
  1. The **target stdlib** marks its asset-producing function (e.g. `image`) as an *asset producer
     of a given kind* (`"image"`) - a generic marker the compiler recognizes on **any** declaration,
     authored in the target-contributed stdlib source (so it stays target-owned). The marker names a
     kind, never an editor.
  2. The **compiler** (generic) resolves each call to its declaration; if the declaration carries
     the marker, it emits a `compile:assets` entry `{ range-of-the-string-literal-arg, kind,
     version }`. It only knows "a call to a marked function with a string-literal arg is an editable
     asset of the marker's kind."
  3. The **extension** (generic) maps kind -> editor via the per-kind registry; the lens opens that
     editor seeded from the literal text, and write-back replaces the same range.

  Resolving a call to its declaration requires the stdlib function to be **real compiled source in
  the program** (which the injected-stdlib facility provides) - a hardcoded compiler builtin could
  not carry a target-owned marker without the compiler hardcoding target knowledge. The marker
  *syntax* (a declaration annotation such as a JSDoc `@asset <kind>` tag, vs a branded parameter
  type) is an open editor-phase decision, co-designed with the sound-effect editor. The stdlib's
  `image` function is the carrier; keeping it a single exported function over a plain string literal
  (not a builtin, not interpolated) keeps the mechanism available.
- **Transport: a sibling `compile:assets` message.** The compiler already pushes a per-file
  result after each debounced compile - `CompileDiagnosticsMessage` (`compile:diagnostics`),
  keyed by `file` + content `version` with ranged entries. Asset locations travel in a **sibling
  `compile:assets` message** in the same family, **`version`-keyed** so a lens range matches the
  content it was computed against (no stale lenses after an edit). It is **kind-generic** (each
  entry tagged by asset kind), which keeps diagnostics clean and lets the sound-effect editor
  reuse it. The facility is cross-asset and broader than display; this spec consumes it for
  images.
- This tooling lives in the `mindcraft-lang` extension (the reference checkout), distinct from the
  wodal / cpp / microbit-sim display work; it is editor-only and off the parity path.

## micro:bit-v2 target

The concrete fill-in of the target-parameterized pieces for micro:bit-v2:

- **Display dimensions:** 5x5.
- **Pixel interpretation:** grayscale brightness, 0-255 per pixel. A value crossing the display
  port narrows as: coordinates truncate to int16, brightness truncates to uint8 (wrap, no clamp);
  pinned in `docs/specs/contracts/observable-trace.md`.
- **`Image` type:** the `{ width, height, pixels }` struct registered as a micro:bit-v2 type
  (`api.defineType`; type-atom id appended at implementation, append-only); pixels are grayscale.
  Images are commonly 5x5 (the display size) but may be any size (clipped on draw). The
  `create an image` image factory (surface 1) plus the image editor (surface 3, a
  `CustomLiteralType` in the microbit-sim brain editor) author them.
- **Built-in images:** a small append-only library of built-in image/icon literals defined at the
  micro:bit target level - each a predefined `Image` value. The starter set is `heart`, `happy`,
  `sad`, and the four cardinal `arrow` icons (lit pixel 255); `happy` is the default-image smiley.
  **Surface 1** exposes them as `Image` literal tiles (built). **Surface 2** surfaces them as named
  `Image` constants exported from the target-injected TS stdlib (the same stdlib that hosts the
  `image(...)` builder). They are target-specific - another target defines its own set, since pixel
  interpretation differs.
- **Device `Image` analog:** CODAL `codal::Image` - greyscale 8-bit, ref-counted, mutable,
  arbitrary dimensions, constructible from a string / buffer, with paste / crop / shift / clone.
  CODAL ships **no** built-in image library, so the built-in set above is ours to define.
- **scroll text:** tile `scroll` (key `microbit-v2.display-scroll`, label "scroll text"), action
  id 1026, function id 1035 (`ActuatorDisplayScroll`); optional anonymous String default
  `"hello"`, default per-step delay 120 ms. With `displayWidth` = 5 and spacing 1, completion is
  `start + 6 * (charCount + 1) * delay`. Goldens `display-scroll.mcprogram.bin` +
  `display-scroll.ticks.trace`; the C++ parity test loads the same binary and byte-compares the
  trace.
- **draw image:** tile `draw image` (key `microbit-v2.draw-image`, action id 1031, function id
  1048 `ActuatorDrawImage`; `Image` type-atom id 1029). An optional **anonymous** `Image` (default a
  5x5 smiley) + an optional **named** `duration` in seconds (default 1 second); the `immediately`
  modifier (`microbit-v2.immediately`) preempts the lease. On device the paste maps to a full-frame
  buffer write (CODAL `printAsync(Image, delay = 0)` semantics, or a direct buffer write) with no
  CODAL hold timer; an oversize image clips via CODAL's paste. Goldens `draw-image-forget` /
  `draw-image-timed` / `draw-image-dropped` / `draw-image-defaults` / `draw-image-preempt`
  (`.mcprogram.bin` + `.ticks.trace`); the C++ parity test loads the same binaries and byte-compares.

## Conformance

- The wodal microbit module is the oracle; the C++ port mirrors it. Temporal draws are
  byte-matched via the observable trace: a display-port line for the draw (under the target's
  narrowing) plus the async `action ... async` dispatch line. Completion resolves on VM tick
  time, so the trace is deterministic and reproducible across both VMs. Goldens live beside the
  wodal trace specs and the C++ parity test loads the same binary.
- The arbitration outcome is part of the trace and is deterministic via round order plus VM-tick
  lease timing: a dropped draw emits its async action line but no display-port line (its paste is
  discarded) and resolves immediately.
- The compiled `Image` value is a brain-program constant and is on the parity path (the `draw
  image` actuator reads the struct and writes the display port identically on both VMs). The
  surface-3 editor UI that authors it is sim-only and not byte-matched.
- The device-driver animation-complete event is not on the parity path.

## Open questions

1. ~~**TS-ambient form of the built-in images**~~ **Resolved:** named `Image` constants exported
   from a target-injected TS stdlib (ordinary source compiled with the user's program). Remaining
   detail: whether the stdlib's icon art is kept in sync with the surface-1 built-in bytes by hand
   (deliberate duplication today) or generated from one source.
2. **How far to formalize the target seam now**: the dimensions + interpretation seam is settled,
   but the minimal interface a target exposes (e.g. width/height accessors, a narrow-pixel hook)
   is specified only as much as micro:bit needs until a second display target is scoped.
3. **Transparency** (the literal form is settled - `image(...)` function over a template string):
   the transparency representation (mask vs sentinel) and whether the transparent draw mode ships in
   the first cut; the hex->brightness mapping; ragged-row handling.
4. **VS Code CodeLens editor** (see that section): the concrete shape of the cross-asset
   `compile:assets` facility (the kind tag, the per-entry payload, the editor registry), to be
   co-designed with the planned sound-effect editor; write-back (`WorkspaceEdit` on the open
   document vs the extension's bridge full-file write).
