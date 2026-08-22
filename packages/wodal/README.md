# WODAL

WODAL is a CODAL-inspired web device runtime, initially implementing the microbit profile.

## Ownership

`packages/wodal` owns simulated microbit functionality and runtime mechanics. Application packages such as `apps/microbit-sim` own visual presentation, project management, and integration wiring.

The Wendoo API for WODAL is adapter-shaped. It must not store device or VM execution state in process-global singletons. Each `createMicroBitV2Module()` install registers types and host functions into the `BrainServices` instance for one `WendooEnvironment`. Runtime device state is supplied through that brain's execution context data, currently `{ microbit }`.

Do not assume WODAL is the only Wendoo platform loaded in the process. Stable identifiers, type IDs, and pure helper functions may live at module scope. Mutable runtime state belongs to one of these scopes:

- the `createMicroBitV2Module()` closure, when it is module configuration for one installed platform module
- the `WendooEnvironment` and its `BrainServices`
- the created brain's execution context data
- the WODAL device instance passed through that context

The initial compiler-facing surface is `ctx.microbit.display`, backed by the WODAL `MicroBitDisplay` facade.
