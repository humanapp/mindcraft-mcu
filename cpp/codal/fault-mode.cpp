#include "codal/fault-mode.h"

namespace wendoo {

void formatFaultCode(char* out, FaultDomain domain, uint16_t code) {
  char* cursor = out;
  switch (domain) {
  case FaultDomain::Load:
    *cursor++ = 'L';
    break;
  case FaultDomain::Runtime:
    *cursor++ = 'E';
    break;
  case FaultDomain::Region:
    *cursor++ = 'R';
    break;
  }

  // Decimal digits of `code`, emitted low-to-high then reversed in place.
  char digits[5];
  uint32_t value = code;
  uint32_t count = 0;
  if (value == 0) {
    digits[count++] = '0';
  } else {
    while (value > 0) {
      digits[count++] = static_cast<char>('0' + value % 10);
      value /= 10;
    }
  }
  for (uint32_t i = count; i > 0; i--) {
    *cursor++ = digits[i - 1];
  }
  *cursor = '\0';
}

void showFaultPass(FaultDisplayPort& display, const char* code) {
  display.showFaultFace();
  display.scrollFaultCode(code);
}

} // namespace wendoo
