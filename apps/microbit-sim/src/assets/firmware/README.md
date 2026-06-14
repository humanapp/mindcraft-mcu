# Bundled micro:bit v2 firmware

A matched pair vendored from one C++ firmware build (`cpp/out/microbit-v2/`):

- `microbit-v2.hex` - the prebuilt firmware as Intel HEX, copied from `MICROBIT.hex`.
- `microbit-v2.metadata.json` - the on-flash region placement, copied from
  `MICROBIT.metadata.json`.

The two files must always come from the same build: the patcher writes the
program into the region described by the metadata, so a mismatched hex/metadata
pair would patch the wrong flash offset. After rebuilding the firmware, re-vendor
both together with `npm run vendor:firmware`, which copies them from
`cpp/out/microbit-v2/` and refuses to copy a half-present pair.
