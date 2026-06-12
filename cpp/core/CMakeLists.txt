# The host-agnostic runtime library. Builds with exceptions and RTTI off; all
# error propagation is by Status/Result return values.
add_library(mindcraft-core STATIC
  runtime/bytecode.cpp
  runtime/error-code.cpp
  runtime/load-error.cpp
)

target_include_directories(mindcraft-core PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/..)

target_compile_options(mindcraft-core PRIVATE
  -fno-exceptions
  -fno-rtti
  -Wall
  -Wextra
  -Werror
)
