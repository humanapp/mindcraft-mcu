#include "codal/on-flash-region.h"

namespace mindcraft {

namespace {

/** True when the leading four bytes are the erased-flash pattern (`0xff`). */
bool isErasedMagic(ByteSpan region) {
  return region[0] == 0xff && region[1] == 0xff && region[2] == 0xff && region[3] == 0xff;
}

/** True when the leading four bytes equal {@link kRegionMagicBytes}. */
bool isRegionMagic(ByteSpan region) {
  return region[0] == kRegionMagicBytes[0] && region[1] == kRegionMagicBytes[1] &&
         region[2] == kRegionMagicBytes[2] && region[3] == kRegionMagicBytes[3];
}

} // namespace

Result<ByteSpan, RegionError> readRegionProgram(ByteSpan region) {
  if (region.size() < kRegionHeaderSize || isErasedMagic(region)) {
    return Result<ByteSpan, RegionError>::fail(RegionError::NoProgram);
  }
  if (!isRegionMagic(region)) {
    return Result<ByteSpan, RegionError>::fail(RegionError::InvalidMagic);
  }
  if (region[4] != kOnFlashFormatVersion) {
    return Result<ByteSpan, RegionError>::fail(RegionError::UnsupportedFormatVersion);
  }
  return Result<ByteSpan, RegionError>::ok(
      ByteSpan(region.data() + kRegionHeaderSize, region.size() - kRegionHeaderSize));
}

} // namespace mindcraft
