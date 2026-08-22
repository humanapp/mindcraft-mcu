# The host-agnostic runtime library. Builds with exceptions and RTTI off; all
# error propagation is by Status/Result return values.
add_library(wendoo-core STATIC
  codec/program-reader.cpp
  runtime/binary32-format.cpp
  runtime/binary32-parse.cpp
  runtime/binary32-transcendental.cpp
  runtime/brain-runtime.cpp
  runtime/bytecode.cpp
  runtime/core-host-functions.cpp
  runtime/error-code.cpp
  runtime/fiber-scheduler.cpp
  runtime/load-error.cpp
  runtime/managed-heap.cpp
  runtime/vm.cpp
)

# The single-precision numeric pin reproduces the TypeScript reference's
# per-operation rounding. Fused multiply-add would collapse `a * b + c` into a
# single rounding and diverge, so these units forbid FP contraction. A runtime
# guard (binary32::multiplyAddRoundsTwice) fails the test suite if the flag is
# dropped.
set_source_files_properties(
  runtime/binary32-format.cpp
  runtime/binary32-parse.cpp
  runtime/binary32-transcendental.cpp
  PROPERTIES COMPILE_OPTIONS "-ffp-contract=off"
)

target_include_directories(wendoo-core PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/..)

target_compile_options(wendoo-core PRIVATE
  -fno-exceptions
  -fno-rtti
  -Wall
  -Wextra
  -Werror
)
