# Mindcraft MCU

Bring [Mindcraft](https://github.com/humanapp/mindcraft-lang) brains to the
[BBC micro:bit](https://microbit.org/).

Mindcraft programs are built by arranging **tiles** -- typed, composable tokens
-- into **rules**. Each rule has a WHEN side (condition) and a DO side (action).
A collection of rules forms a **brain** that drives an autonomous actor. This
repository takes those brains off the screen and onto hardware: it hosts a
native C++ implementation of the Mindcraft bytecode VM that runs on the
micro:bit v2, a web-based device runtime and simulator for authoring and testing
brains in the browser, and the micro:bit platform surface (display, buttons,
accelerometer, radio, GPIO, I2C, and robot chassis drivers) exposed to brains as
sensors and actuators.

The Mindcraft language, compiler, and reference VM live in the upstream
[mindcraft-lang](https://github.com/humanapp/mindcraft-lang) repository, included
here as a git submodule under `external/`. The TypeScript reference VM is the
executable specification; the native VM and the web runtime both mirror its
observable bytecode semantics byte-for-byte.

## Two VMs, one contract

Every conforming Mindcraft VM decodes the same bytecode to the same semantics.
This repository adds two implementations to the reference one:

| Runtime | Where | Role |
|---------|-------|------|
| TypeScript reference VM | [external/mindcraft-lang](external/mindcraft-lang) (submodule) | Executable spec; source of golden traces. |
| Native C++ VM | [cpp/](cpp/) | On-hardware runtime; compiles to `MICROBIT.hex` for the micro:bit v2. |
| WODAL web runtime | [packages/wodal](packages/wodal/) | CODAL-inspired device model that runs brains in the browser. |

The compiler is target-unaware: it emits identical bytecode regardless of the
eventual runtime. Host and platform differences are expressed through registered
host functions, actuators, and device adapters -- never through opcode subsets.

## Packages

| Package | Description |
|---------|-------------|
| [@mindcraft-lang/wodal](packages/wodal/) | WODAL -- a CODAL-inspired web device runtime for the Mindcraft bytecode VM. Models micro:bit peripherals, event/fiber mechanics, and radio through host-loop drains. Ships a `wodal` CLI. |

## Apps

| App | Description |
|-----|-------------|
| [micro:bit Simulator](apps/microbit-sim/) | Author, run, and debug Mindcraft brains against a simulated micro:bit in the browser. Flash brains to a physical micro:bit over WebUSB, drive synthetic device inputs (gestures, light level, temperature), and inspect per-brain diagnostics. |

## Native tree

| Directory | Description |
|-----------|-------------|
| [cpp/](cpp/) | Native C++ Mindcraft VM. `core/` is the host-agnostic runtime, `codal/` the board-agnostic CODAL layer, and `targets/microbit-v2/` the micro:bit v2 firmware that boots a brain from a reserved on-flash region. See the [cpp README](cpp/README.md) for the layout and device build. |

## Getting Started

This repository is not an npm workspaces monorepo. Each package and app installs
into its own `node_modules`; cross-package links use `file:` dependencies. The
Mindcraft language lives in a submodule, so initialize submodules first.

```bash
# Clone with submodules (or run `git submodule update --init --recursive`)
git clone --recurse-submodules https://github.com/humanapp/mindcraft-mcu.git
cd mindcraft-mcu

# Install packages and apps
npm install
```

Run the micro:bit simulator:

```bash
npm --prefix apps/microbit-sim run dev
```

Building the micro:bit v2 firmware uses its own CODAL/Docker flow rather than the
host CMake tree; see [cpp/README.md](cpp/README.md) for the device build, and
its "Build, test, and check" section for building and running the native VM
tests on your workstation.

## Documentation

Feature specifications live under [docs/specs/](docs/specs/) -- one normative
document per capability (display, radio, accelerometer, GPIO, I2C, movement, and
more). These specs are the contract; the reference VM, native VM, and WODAL are
all held to them.

## Contributing

To report a bug or request a feature, please
[open an issue](https://github.com/humanapp/mindcraft-mcu/issues).

## License

[MIT](LICENSE)
