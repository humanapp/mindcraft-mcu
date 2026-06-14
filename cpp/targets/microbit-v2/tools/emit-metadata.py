#!/usr/bin/env python3
# Emit the build->patcher firmware metadata next to the firmware hex: the region
# offset and size read from the linked ELF's region symbols (placed by
# mcprogram-region.ld), plus the on-flash magic and format version. The magic
# and version mirror the on-flash header (cpp/codal/on-flash-region.h) and the
# wodal schema (firmware-metadata.ts); keep them aligned.
#
# Run from this directory after build.py (the Dockerfile does both):
#   python3 tools/emit-metadata.py

import json
import pathlib
import re
import subprocess

TARGET_DIR = pathlib.Path(__file__).resolve().parents[1]
ELF = TARGET_DIR / "build" / "MICROBIT"
OUT = TARGET_DIR / "MICROBIT.metadata.json"

SCHEMA_VERSION = 1
ON_FLASH_FORMAT_VERSION = 1
REGION_MAGIC_HEX = "4d434652"  # "MCFR" in on-flash byte order


def symbol_address(nm_output: str, name: str) -> int:
    for line in nm_output.splitlines():
        match = re.match(r"^([0-9a-fA-F]+)\s+\S\s+(\S+)$", line)
        if match and match.group(2) == name:
            return int(match.group(1), 16)
    raise SystemExit(f"region symbol not found in {ELF}: {name}")


def main() -> None:
    if not ELF.exists():
        raise SystemExit(f"firmware ELF not found: {ELF} (run build.py first)")
    nm_output = subprocess.check_output(["arm-none-eabi-nm", str(ELF)], text=True)
    start = symbol_address(nm_output, "__mcprogram_region_start")
    end = symbol_address(nm_output, "__mcprogram_region_end")

    metadata = {
        "schemaVersion": SCHEMA_VERSION,
        "regionOffset": start,
        "regionSize": end - start,
        "regionMagic": REGION_MAGIC_HEX,
        "onFlashFormatVersion": ON_FLASH_FORMAT_VERSION,
    }
    OUT.write_text(json.dumps(metadata, indent=2) + "\n")
    print(f"wrote {OUT}: region {start:#x} +{end - start} bytes")


if __name__ == "__main__":
    main()
