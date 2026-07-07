# Spec: Assistant (LLM-assisted authoring and explanation)

The **Assistant** is an LLM-backed collaborator embedded in a Mindcraft target. It turns natural-
language intent ("I want my robot to run from light and hide in the shadows") into tile-code,
developed incrementally through the same editor operations a person uses, and it answers questions
about a brain's behavior from the runtime's own execution traces ("why did you run toward the
light?"). It is a layer over the editor and runtime, never a dependency: every target is fully
usable with the Assistant absent.

The Assistant is target-generic. The same substrate serves a tutor panel in a device simulator, an
in-character creature companion in a game target, and any future target that hosts the brain editor.
Persona is a per-target skin over one shared contract.

This is a product-level feature spanning the Tiles surface (editor, picker, badges), the Device API
surface (authoring new tiles as an escape hatch), and the Simulator surface (scenario staging and
demonstration). Its integration contract is a shared-package product contract, not the property of
any one app.

## Why it exists

Tile-code is designed to express high-level intent simply. The Assistant closes the remaining gap:
the translation from intent held in language to intent expressed in rules -- in both directions.
Forward, it removes the tedium between "what I want" and "the rules that do it" while teaching the
mapping. Backward, it makes a running brain legible: the runtime always knows exactly which rules
fired and why, and the Assistant renders that knowledge as conversation.

The platform is unusually suited to this. Tile-code is a small closed language: a whole brain and
the whole tile catalog fit in a model's working context. The tile suggestion service is a legality
oracle -- at every insertion point it computes exactly the set of valid tiles, and it agrees with the
compiler by construction. The compiler validates hard requirements (placement, accessor bases,
output providers, capability requirements, WHEN-result availability) with machine-readable
diagnostics. The headless runtime compiles and simulates a brain deterministically in milliseconds
and emits reproducible traces. Together these give the Assistant what general-purpose coding
assistants lack: generation that cannot produce invalid programs, and claims that can always be
checked against ground truth.

## The Assistant contract

Four principles bind every Assistant feature on every target. They are the product's trust
guarantees, peers of the compiler trust contract.

1. **Legality.** The Assistant only produces edits the editor itself would allow. Tile placements
   are drawn from (or validated against) the tile suggestion service's offering for the insertion
   point; whole-brain results always compile. An Assistant that wants something the language cannot
   express says so; it never emits a broken intermediate state.
2. **Verification.** The Assistant never asserts runtime behavior it has not observed. Every
   behavioral claim ("now it hides in shadows") is backed by a simulation it ran; explanations of
   past behavior cite the rules that actually fired. Unverified expectations are stated as
   expectations, not facts.
3. **Same operations.** The Assistant edits through the editor's own command operations -- the same
   commands a person's clicks produce, recorded in the same command history. Every intermediate
   state is a real, valid, badge-checked editor state; undo applies to Assistant edits exactly as to
   the user's own; the user can take over mid-stream at any point.
4. **Presence is optional.** Every target functions completely without the Assistant -- offline,
   unconfigured, or disabled. No editor, compiler, or runtime capability may require it.

## The authoring loop

A request flows: intent -> plan -> incremental edits -> verify -> demonstrate.

- **Intent.** The user states a goal in natural language, at any granularity ("make it faster when
  scared", "build the whole light-avoidance behavior").
- **Plan.** The Assistant decomposes the goal against the catalog: which sensing, which conditions,
  which actions, which rules. Where the catalog lacks a needed capability, the plan says so and
  proposes the escape hatch (see Authoring new tiles) or, on morphology-coupled targets, a body
  change (see Capability-coupled morphology).
- **Incremental edits.** The Assistant applies the plan as a sequence of small editor operations --
  add a rule, place a WHEN sensor, place a comparison, place a DO action -- each narrated in concept
  language (the WHEN result, the light level, the drive action), never in internal identifiers.
- **Verify.** After each coherent step and at the end, the Assistant compiles and simulates. A
  failed expectation sends it back to the plan, visibly: revision is part of the shown process, not
  hidden.
- **Demonstrate.** The Assistant stages a scenario (see Scenario demonstrations) and shows the
  behavior meeting the intent.

## The edit stream is the lesson

The narrated edit sequence is a first-class artifact -- the **lesson** -- not a transient chat
transcript. Its defining property: teaching and doing are the same artifact at different playback
speeds.

- **Watch** plays the edits tile by tile with narration, the brain simulating at each step.
- **Step** advances one edit at a time under user control.
- **Skip** applies the remainder immediately and jumps to the demonstration.

A lesson can be replayed later against the brain state it started from. Steps are the editor's own
command operations, so a replay is a real re-application, not a video.

**Guided mode.** Because the tile suggestion service computes the true valid-tile set at every
point, the Assistant can pose any step as a question instead of an action: "we need a tile that
senses light -- which of these is it?", offering a small choice set drawn from the real offering with
one correct answer. Guided mode turns authoring into a game without hand-authored lesson content,
and it degrades gracefully: a wrong pick gets a grounded explanation of what that tile actually
does, drawn from the same catalog metadata.

The lesson deliberately mirrors the experience of reading an agent's verbalized reasoning: the value
is that the process is there to read, not that the user is forced through it. Skip is always
available; the design goal is to make watching genuinely interesting, not to gate the result.

## Explanation: answering "why" from traces

The inverse direction of authoring. The runtime records, every think, which rules fired, what each
WHEN evaluated to (including the WHEN result), and what actions dispatched; compile metadata maps
execution points back to tiles. The Assistant consumes these traces to answer questions about
observed behavior:

- "Why did you do that?" -- names the rule(s) that fired and renders their WHEN/DO in concept
  language, with the sensed values that made the WHEN true.
- "Why didn't it work?" -- identifies the rule that never fired and the condition that was never
  met, with the actual sensed values ("the light level never dropped below 20 -- this room is
  bright").
- "What would happen if...?" -- runs the hypothetical as a simulation and reports what the trace
  shows.

Explanations are grounded exclusively in traces, catalog metadata, and the brain's actual rules. On
in-character targets the same content is voiced by the creature ("I ran toward the light because my
rule says WHEN I see light, DO move toward it"); character never overrides grounding -- the creature
explains what it did from what fired, and does not claim motives its rules do not encode.

## Capability-coupled morphology

On targets where the programmable thing has a body composed of parts (a creature-creator target),
parts and tiles are coupled through the existing capability mechanism: **parts provide capabilities;
tiles require them.** Eyes provide seeing; legs provide walking; a light-sensing organ provides the
light-level sensor. Editing the body edits the tile catalog the brain may use, and the picker and
compiler enforce the coupling exactly as they do for any capability provider today.

The Assistant reasons across the boundary as one design space. When intent needs a sense or ability
the body lacks, the plan includes the body change: "to hide in shadows it needs to sense light --
want a light-sensing antenna?" -- a sculpt step -- "now we can write the rule." Behavior goals drive
body design; body design expands the behavior surface. Sculpting assistance itself (proposing and
applying part/parameter edits) follows the same contract as code assistance: the Assistant
manipulates the same part model the user's tools do, through validated operations, incrementally
and narratedly.

On targets without morphology (a fixed device), this section is inert; the capability mechanism
still gates tiles (e.g. by attached peripherals) and the Assistant reasons about it the same way
("that needs the sonar module on pins P8/P12 -- is one attached?").

## Scenario demonstrations

When the Assistant claims a behavior works, it shows it: it stages a scenario through the target's
deterministic injectable-input mechanism (the same paths the conformance harness scripts -- sensor
values, radio packets, world state), runs the simulation, and presents the outcome. The scenario is
part of the lesson artifact and doubles as the behavior's acceptance check: replaying the lesson
replays the demonstration. A demonstration that stops passing after later edits is surfaced, not
silently dropped.

## The Assistant bridge

The integration contract is a tool surface exposed by a shared package -- the **assistant bridge** --
consumed by any model harness and any target UI. It is the product contract; target apps own only
their presentation.

| Tool | Purpose |
| ---- | ------- |
| read project | The brain document(s), pages, rules, tiles -- the complete program |
| read catalog | Every available tile with full metadata: types, argument grammar, capability requirements and provisions, output provisions, WHEN-result consumption, placements, conversions, documentation |
| suggest | The legality oracle: the valid tile set at a given insertion or replacement point |
| propose edit | A validated editor command operation (place, replace, delete, add rule, ...); rejected proposals return the machine-readable diagnostic |
| compile | Whole-brain compile; returns structured diagnostics |
| simulate | Run a compiled brain against a staged scenario for N thinks; returns the trace |
| read trace | Structured access to rule fires, WHEN results, action dispatches, sensed values |

Properties:

- **Model-agnostic.** The bridge presumes nothing about which model or harness drives it. Targets
  may tier work -- a large model for planning and narration, a small or local model (or plain
  search) for constrained pick-among-offered steps -- behind the same tools.
- **Validated at the boundary.** `propose edit` enforces the legality principle mechanically; a
  misbehaving model cannot corrupt a brain document.
- **Morphology extension.** On capability-coupled targets the bridge additionally exposes the part
  model and validated part-edit operations, with the same shape as the code tools.
- **Attribution.** Assistant edits are ordinary command-history entries, distinguishable as
  assistant-originated for display and undo grouping, but structurally identical to user edits --
  one history, one document format, nothing assistant-specific persisted in the brain document
  itself.

## Authoring new tiles

When intent exceeds the catalog ("make it sing when it is happy" on a target with no such tile), the
Assistant's escape hatch is the same one a person has: author a user tile in TypeScript through the
Device API surface. Assistant-authored tiles are ordinary user code -- compiled, validated, and
reviewed in the project like any other -- and travel through the extension system when shared. The
Assistant states clearly when it is crossing from arranging existing tiles to authoring new ones,
and the lesson shows the new tile's source as part of the process.

## Personas

- **Tutor** (device-simulator targets): a neutral, teaching-forward voice in an editor panel.
- **The creature itself** (creature targets): first-person, in-character; the brain being edited is
  the character's mind, and explanation reads as the creature telling you about itself.
- Persona affects voice, framing, and UI placement only. The contract, the bridge, the lesson
  artifact, and the grounding rules are identical underneath.

## Safety and audience

- Grounded claims only, per the contract: behavior claims cite simulations; explanations cite
  traces; catalog claims cite metadata. The Assistant does not speculate about the platform.
- Audience-appropriate by target: creature and classroom targets constrain register and content for
  children; the persona layer owns tone, the bridge owns truth.
- Where model inference runs (hosted, local, school-managed) is a per-target product decision; the
  bridge contract is transport- and locality-neutral by design.

## Deferred surface

Design intent with no current consumer, named to bound the surface rather than to schedule it:

- **Sculpting assistance** waits on a morphology-bearing target; only the bridge's morphology
  extension point is reserved by this spec.
- **Voice interaction** (speaking to the creature) layers on the same bridge; nothing in the
  contract precludes it and nothing requires it.
- **Multi-brain reasoning** (the Assistant reasoning about several brains interacting, e.g. a
  gamepad sender and a chassis receiver) extends read/simulate to multiple documents; single-brain
  scope is the baseline.

## Open questions

(Draft-only; resolve before this spec is normative.)

- **Lesson persistence.** Is the lesson artifact saved with the project, exportable, both? What is
  its document format, and does replay tolerate a brain that has since diverged?
- **Bridge transport.** In-process service for the browser targets is the obvious baseline; is the
  bridge also exposed over a wire protocol (the VS Code bridge precedent) so external harnesses can
  drive it, and is that v1 or deferred?
- **Scenario vocabulary.** Scenario staging needs a target-neutral description format over the
  injectable-input mechanisms; per-target or shared?
- **Guided-mode authoring content.** Fully emergent from catalog metadata, or may targets curate
  question templates for key concepts?
- **Cost and pacing controls.** What budget/consent affordances does a classroom deployment need
  (per-request, per-session, none)?
