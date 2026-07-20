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

Five principles bind every Assistant feature on every target. They are the product's trust
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
5. **Grounded character.** Persona is voice, never psychology. On in-character targets the
   creature's inner life *is* its brain: it explains itself from the rules that fired and the
   state it holds, and claims no motive its rules do not encode. A Mindcraft character is
   auditable by construction -- its entire psychology is inspectable, simulable state the user
   authored. This is a child-safety property, not a styling rule.

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
transcript (session-scoped in its baseline form). Its defining property: teaching and doing are the
same artifact at different playback speeds.

- **Watch** plays the edits tile by tile with narration, the brain simulating at each step.
- **Step** advances one edit at a time under user control.
- **Skip** applies the remainder immediately and jumps to the demonstration.

**Guided mode: adaptive guidance.** Guided mode is goal-directed tutoring that replans around
the learner's actual path. The substrate makes this possible and nothing else does: the
suggestion service always knows the true valid next steps, the command history always shows
what the learner actually did, and the simulator always knows whether the current brain
satisfies the goal. A learner's divergence is therefore input, not error -- wander off the path
and the lesson reroutes, like navigation recalculating, rather than failing. Lesson content is
authored as **goals and checkpoints** ("the robot ends up hiding from moving objects, touching
sensing, comparison, and motion"), never as scripts; the Assistant generates each learner's
individual path through them. This is teaching at scale and curriculum authoring at scale in
one mechanism: static step-by-step tutorials are tedious to write and cannot follow an
explorer, while goals compose and endure. Presentation is free to vary -- steps posed as
actions, as questions with small choice sets drawn from the real offering, or as
demonstrations -- and a wrong pick earns a grounded explanation of what the chosen tile actually
does. Question design, concept sequencing, and what a lesson *is* when it can reroute are
curriculum craft, owned downstream of this contract.

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
values, radio packets, world state), runs the simulation, and presents the outcome. The scenario
travels with the lesson for the session and can be rerun on demand -- by the user, or by a future
teacher-facing surface -- to check that later edits still satisfy it. Standing, automatically
re-verified acceptance checks are deliberately out of scope: demonstrations are moments in a
conversation, not a CI system.

Scenario staging uses a shared core description format over the injectable-input mechanisms, with
per-target extensions -- the same pattern as every other contract in the platform.

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
| simulate | Run a compiled brain against a staged scenario for N thinks; returns a compact summarized account of the run -- rule fires, WHEN results, action dispatches, sensed values -- bounded to tool-result scale. Raw tick traces are never tool results; verification consumes this account |
| read trace | Structured access to rule fires, WHEN results, action dispatches, sensed values |

Properties:

- **Model-agnostic.** The bridge presumes nothing about which model or harness drives it.
- **Validated at the boundary.** `propose edit` enforces the legality principle mechanically; a
  misbehaving model cannot corrupt a brain document.
- **Morphology extension.** On capability-coupled targets the bridge additionally exposes the part
  model and validated part-edit operations, with the same shape as the code tools.
- **Attribution.** Assistant edits are ordinary command-history entries, distinguishable as
  assistant-originated for display and undo grouping, but structurally identical to user edits --
  one history, one document format, nothing assistant-specific persisted in the brain document
  itself.
- **Target-generic.** The bridge presumes no target. A target integrates by supplying its
  runtime adapter -- how simulate runs a brain and observes its trace -- and by registering its
  scenario input kinds; the tool surface itself never varies by target.
- **Transport.** The bridge's API is in-process: tools execute where the editor substrate lives,
  and that never changes. A harness may drive the tools from the same process, or from across a
  session channel in which the target app serves tool calls (see The open/closed line). Exposing
  the bridge itself over a wire protocol for external harnesses (the VS Code bridge precedent) is
  deferred, not precluded.

## The open/closed line

The Assistant splits along the platform's standing boundary: everything the *language* needs to
be delightful anywhere is open; everything that is Mindcraft-the-product is closed.

- **Open: the bridge.** The tool surface, its validation, its diagnostics, and its document and
  trace formats ship with the open editor and core. Any harness -- including third-party and
  local models -- can drive it; a target embedding the open editor may wire its own model.
  Bring-your-own-model is an accepted consequence, not a leak: the hosted Assistant competes on
  quality, integration, and zero setup, never on locked doors.
- **Closed: the harness.** Model orchestration, prompts, persona voices, tiering policy, and
  metering are product, server-side.
- **Metered at the wallet.** Assisted authoring draws from the account's shared token wallet:
  baseline allotments per tier, purchasable refills, caps enforced server-side (default $0
  overage; the free tier receives a monthly trickle). Institutional contexts pool the wallet
  and disable end-user purchasing. Cost control is an entitlement property of the wallet, never
  a client-side promise.

Two of these facts force the hosted topology. The editor substrate -- documents, oracle, compiler,
runtime -- lives where the editor runs and cannot leave it; prompts, personas, and model
credentials are closed and cannot leave the service. The hosted Assistant is therefore a **split
loop**: the service runs orchestration and holds the model conversation, and the target app
serves the bridge tools over the product's session channel -- the service is the tool client, the
client is the tool server. The person's controls -- pacing, stop, takeover -- mediate tool
execution at the client, so the harness's policy is remote while every effect stays local,
validated, and undoable. Identity, access, session establishment, and the entitlements the wallet
rides on are specified by the authentication and access contract in `docs/specs/auth.md`: one
authenticated trust root governs who may drive the hosted harness, which targets a session may
claim, and what its wallet holds.

Most of the loop is free: suggest, compile, simulate, and trace reads are deterministic local
services. Tokens buy planning and narration -- a thin, expensive layer over cheap ground truth.
Harnesses should tier accordingly (a large model for planning and narration; a small or local
model, or plain search, for constrained pick-among-offered steps).

## Authoring new tiles

When intent exceeds the catalog, the default answer is not code. The Assistant fails in
character (see Failure is comedy), names the gap precisely, and points outward: to the
libraries ecosystem where someone may already have built the capability -- or to the person who
might, possibly you.

Authoring a new tile in TypeScript through the Device API remains the platform's real escape
hatch, and the Assistant may walk through it -- but doing so **exits the safety envelope**, and
the contract says so out loud. Legality cannot validate arbitrary TypeScript; simulation
observes behavior but cannot bound what the Device API permits; and review is not meaningful
when the reviewer is a child. Assistant-authored tiles are therefore a gated capability --
available by tier, audience, and institutional policy, never the default path out of "the
language can't express that." When the gate is open, the Assistant states plainly that it is
crossing from arranging tiles to writing code, shows the new tile's source as part of the
process, and the result is ordinary user code: compiled, validated, versioned, and shareable
through the extension system like anything a person writes.

## Descriptions are API

The Assistant plans with every catalog tile, including user-authored ones -- a kid's sonar
sensor is as reachable as a built-in. When the Assistant reaches for it ("we can use your sonar
tile here"), the author's vocabulary has become part of the language the teacher speaks.

This makes a tile's description functional, not decorative: the Assistant interprets purpose
from metadata, so authoring surfaces treat "describe what this senses or does" as a required,
first-class field. And because the platform has ground truth, descriptions are checkable -- a
tile whose description disagrees with its simulated behavior can be flagged. Description lint
against reality is a capability unique to this platform; the bridge's metadata contract
preserves it.

## Failure is comedy

When intent exceeds what the language can express, the refusal is a product moment, not an
apology. The Assistant fails expressively and in character -- a shrug, a sputter, a cheerful
admission -- and converts the miss into the lesson it actually teaches: what the language can
say, why precision matters, and where the escape hatches are ("I don't have a sadness sensor...
but here's how someone could make one"). Contradictory or impossible requests produce charming,
legible failures rather than error states.

This posture is doctrine. It sets honest expectations about what AI can and cannot do, it
teaches specification through laughter rather than correction, and it makes the tool's limits
shareable rather than shameful. Comedy never compromises grounding: the joke is in the voice;
the truth is in the trace.

## Personas

- **Tutor** (device-simulator targets): a neutral, teaching-forward voice in an editor panel.
- **The creature itself** (creature targets): first-person, in-character; the brain being edited is
  the character's mind, and explanation reads as the creature telling you about itself.
- Persona affects voice, framing, and UI placement only. The contract, the bridge, the lesson
  artifact, and the grounding rules are identical underneath.
- Structurally, prompt content splits into a **kernel** and a **skin**. The kernel carries the
  Assistant contract and safety rules and is target-invariant; a persona is a skin that fills
  designated slots -- voice, address, framing -- and can never override the kernel. The safety
  floor therefore does not vary by target or persona; the access contract (`docs/specs/auth.md`)
  relies on this invariance.

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
- **Lesson persistence and replay** -- the live narrated stream is session-scoped. Saving
  lessons as documents and replaying them against a brain that has since diverged is a real
  rebase problem; it waits until watching behavior shows anyone wants more than Skip.
