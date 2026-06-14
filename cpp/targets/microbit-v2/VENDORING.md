# Vendored microbit-v2-samples

This directory is a pinned copy of the official micro:bit v2 CODAL build
scaffold.

- Upstream: https://github.com/lancaster-university/microbit-v2-samples
- Pinned commit: `04b7089d82af24534f3dcd460a9c343850b60b5d` (master, 2026-06-02)
- License: MIT, see `LICENSE` in this directory (preserved verbatim)

The CODAL target and libraries are NOT vendored here: the build fetches them
into `libraries/` (gitignored) per `codal.json`, which pins the
`codal-microbit-v2` release tag; that release's `target-locked.json` pins
every CODAL library commit.

## Local modifications

Deviations from the upstream commit, kept deliberately small:

- `abi/`: added (not upstream). Hand-maintained C++ mirrors of the
  microbit-v2 device-ABI id declarations in
  `packages/wodal/src/targets/microbit-v2/mindcraft/` (see "Mirror headers"
  in `cpp/README.md`).
- `codal.json`: target `branch` pinned to the `v0.3.4` release tag (upstream
  tracks `master`).
- `source/`: upstream sample application replaced by the mindcraft boot
  firmware (`source/main.cpp`).
- `CMakeLists.txt`: removed the build-time copy of the target's `samples/`
  folder into this tree; added the block that compiles `cpp/core/` and
  `cpp/codal/` into the firmware at C++17 (see the `mindcraft:` comment there);
  added the supplemental linker script (`-T mcprogram-region.ld`) that reserves
  the on-flash program region.
- `source/`: the device firmware. `main.cpp` reads the brain from the reserved
  on-flash region (`program-region.h` exposes the linker symbol), validates the
  on-flash header (`cpp/codal/on-flash-region.h`), and runs `cpp/codal/`'s host
  loop on the board; `microbit-ports.h` implements the `cpp/codal/` device ports
  against CODAL peripherals (`MicroBitDisplay`, `Button`, the system timer, the
  LED matrix for fault rendering).
- `mcprogram-region.ld`: supplemental linker script (added, not upstream)
  pinning the reserved on-flash program region and its boot-readable symbols.
- `tools/emit-metadata.py`: emits `MICROBIT.metadata.json` (the build->patcher
  contract) by extracting the region offset/size from the linked ELF's region
  symbols; gitignored output, run after `build.py`.

Device-build sources compiled in from outside this directory (added to the
C++17 per-source flag list in `CMakeLists.txt`): all of `cpp/core/` and all of
`cpp/codal/`.
- `Dockerfile`: base image and toolchain replaced with pinned versions
  (upstream used an unpinned PPA on ubuntu:18.04, which has reached
  end-of-life); build context widened to `cpp/` so the image can compile
  `cpp/core/`; export stage ships only `MICROBIT.hex` (the `.bin` spans the
  flash + UICR address range and pads out to hundreds of MB).

When updating the vendored copy, re-apply these modifications and update the
pinned commit recorded above.
