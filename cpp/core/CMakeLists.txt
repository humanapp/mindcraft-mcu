# The host-agnostic runtime library. Builds with exceptions and RTTI off; all
# error propagation is by Status/Result return values.
add_library(mindcraft-core STATIC
  codec/observable-trace.cpp
  codec/program-dump.cpp
  codec/program-reader.cpp
  runtime/brain-runtime.cpp
  runtime/bytecode.cpp
  runtime/error-code.cpp
  runtime/fiber-scheduler.cpp
  runtime/load-error.cpp
  runtime/managed-heap.cpp
  runtime/vm.cpp
)

target_include_directories(mindcraft-core PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/..)

target_compile_options(mindcraft-core PRIVATE
  -fno-exceptions
  -fno-rtti
  -Wall
  -Wextra
  -Werror
)
