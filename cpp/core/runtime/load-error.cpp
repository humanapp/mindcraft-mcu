#include "core/runtime/load-error.h"

namespace mindcraft {

const char* loadErrorName(LoadError code) {
  for (const LoadErrorName& entry : kLoadErrorNames) {
    if (entry.code == code) {
      return entry.name;
    }
  }
  return nullptr;
}

} // namespace mindcraft
