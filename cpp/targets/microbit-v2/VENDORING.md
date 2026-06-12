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
  folder into this tree; added the block that compiles `cpp/core/` into the
  firmware at C++17 (see the `mindcraft:` comment there).
- `Dockerfile`: base image and toolchain replaced with pinned versions
  (upstream used an unpinned PPA on ubuntu:18.04, which has reached
  end-of-life); build context widened to `cpp/` so the image can compile
  `cpp/core/`; export stage ships only `MICROBIT.hex` (the `.bin` spans the
  flash + UICR address range and pads out to hundreds of MB).

When updating the vendored copy, re-apply these modifications and update the
pinned commit recorded above.
