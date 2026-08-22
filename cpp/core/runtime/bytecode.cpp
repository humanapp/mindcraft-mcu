#include "core/runtime/bytecode.h"

namespace wendoo {

const OpOperandSchema* operandSchemaFor(Op op) {
  for (const OpOperandSchema& row : kOperandSchema) {
    if (row.op == op) {
      return &row;
    }
  }
  return nullptr;
}

} // namespace wendoo
