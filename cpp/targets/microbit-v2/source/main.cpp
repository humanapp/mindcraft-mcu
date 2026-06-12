#include "MicroBit.h"

#include "core/runtime/error-code.h"
#include "core/runtime/result.h"

MicroBit uBit;

/**
 * Boot firmware: initializes CODAL and emits a heartbeat line over serial
 * (115200 baud) once per second, exercising the compiled-in mindcraft core
 * (an ErrorCode name lookup and a Result round-trip).
 */
int main() {
  uBit.init();

  const char* coreProbe = mindcraft::errorCodeName(mindcraft::ErrorCode::ScriptError);
  mindcraft::Result<int32_t> result = mindcraft::Result<int32_t>::ok(42);

  int tick = 0;
  while (true) {
    uBit.serial.printf("mindcraft-mcu boot: core=%s value=%d tick=%d\r\n", coreProbe,
                       (int)result.value(), tick);
    tick = tick + 1;
    uBit.sleep(1000);
  }
}
