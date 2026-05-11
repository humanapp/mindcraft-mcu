---
applyTo: "**"
---

<!-- Adapted from external/mindcraft-lang/.github/instructions/global.instructions.md -->

# GitHub Copilot Instructions

## Code Examples and Documentation

Never create example source files in a project's `src` folder.

If creating ad-hoc feature documentation or example files, place them in a
`generated-docs/` folder at the project root to clearly indicate non-source,
auto-generated status. Never place example or documentation files in any `src`
folder. Include the creation date in the file name, for example
`example-feature-2026-05-10.ts` or `docs-feature-2026-05-10.md`.

## Comments in Source Files

This codebase is used for teaching, so API documentation is desired. Document
exported types, functions, classes, and non-trivial fields with JSDoc that
explains what they are and how to use them, so a reader can understand the code
without external context.

What to write:

- JSDoc on exported symbols, including types, interfaces, classes, functions,
  and public methods, describing purpose, inputs, outputs, and invariants.
- Field-level JSDoc on non-obvious properties, including units, formats,
  allowed values, and nullability semantics.
- Brief inline comments where the logic itself is non-obvious and a reader
  would genuinely benefit from a hint about intent or an invariant.

What not to write:

- Rationale or history-lesson comments. Do not explain why a file is structured
  a certain way, why a refactor was done, or what constraints drove a past
  design decision.
- Comments that just restate what the code literally does.
- Stub-style placeholders like `// no implementation yet, but could add things
  like ...`.

Avoid design-justification comments that explain why the current shape was
chosen rather than what it is. A reader who has never seen the alternative gains
nothing from them.

Treat the following phrasings as red flags in JSDoc on exported symbols and
delete them when they introduce design rationale:

- "... so that ..."
- "... rather than ..." when comparing the chosen design to an alternative
- "... instead of ..." when comparing the chosen design to an alternative
- "... not a ... -- ..."
- "... is exposed because ..."
- "... was chosen ..."

Removal test: cover the comment with your hand and re-read the code. If a
reader cannot figure out what the field or function is, or how to use it
correctly, without the comment, keep it. If covering the comment only removes
justification of the current design, delete it.

## ASCII-Only Text in Comments and Documentation

Use only keyboard-typable ASCII characters in code comments, markdown
documentation, and string literals used for logging or display. Do not use
Unicode arrows, em dashes, bullet characters, box-drawing characters, or other
non-keyboard symbols.

Common substitutions:

- `->` instead of Unicode right arrows
- `<-` instead of Unicode left arrows
- `--` instead of em dash
- `-` instead of en dash, bullet characters, or middle dots
- `|` instead of box-drawing vertical lines
- `-` instead of box-drawing horizontal lines
- `[x]` instead of checkmark emoji
- `[ok]` instead of checkmark symbols

## Communication Style

Avoid excessive agreement and reinforcement phrases such as "You're right!",
"Exactly!", and "Perfect!". Be direct and matter-of-fact in responses. Focus on
providing solutions and information rather than validating statements.

## Generated Files -- Do Not Read

Never read `external/mindcraft-lang/packages/ts-compiler/src/compiler/lib-dts.generated.ts`
when exploring the codebase. It is a machine-generated file that repackages
TypeScript's `lib.d.ts` as a string constant. It contains no project logic and
is extremely large. Skip it in all searches and explorations.

## After Making Code Changes

After making code changes in this workspace, run the package's typecheck and
check commands when that package provides them. For documentation-only changes,
validation can be limited to `git diff --check` and any relevant doc checks
available in the repo.

### Zero-Noise Policy for Checks

The passing bar for format/lint checks is no warnings, infos, or fixable output.
Any output beyond a clean success summary means the check has failed. Treat
infos identically to errors.

## Broad View Before Acting

Before making any change that touches more than one call site, method
signature, or data flow, read all involved files end-to-end and explicitly
identify every invariant the change must preserve: ordering, symmetry,
consistency across parallel code paths, and structural conventions.

Examples of invariants to check:

- If two methods delegate to the same set of components, they must call them in
  the same order.
- If a refactor introduces a new interface, all implementations must be
  symmetric.
- If a pattern exists across parallel code paths, changes must preserve that
  parallelism.

If a proposed change would violate any identified invariant, reject it and find
an approach that does not.

The goal is not just to fix the immediate problem. Leave the code cleaner and
more coherent than it was found. If the task reveals a structural issue adjacent
to the immediate change, address it as part of the same change when doing so is
within scope.
