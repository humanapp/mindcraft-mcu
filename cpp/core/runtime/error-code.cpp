#include "core/runtime/error-code.h"

namespace wendoo {

const char* errorCodeName(ErrorCode code) {
  for (const ErrorCodeName& entry : kErrorCodeNames) {
    if (entry.code == code) {
      return entry.name;
    }
  }
  return nullptr;
}

} // namespace wendoo
