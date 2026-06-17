# Host-only tooling that renders a decoded program or a VM run as canonical
# text for the parity tests. The device firmware never reads these emitters,
# so they live outside cpp/core (whose tree the firmware build globs whole) and
# are compiled only by this desktop library and the test suite that links it.
# Builds with exceptions and RTTI off to match the core library it renders.
add_library(mindcraft-hostkit STATIC
  observable-trace.cpp
  program-dump.cpp
)

target_link_libraries(mindcraft-hostkit PUBLIC mindcraft-core)

target_compile_options(mindcraft-hostkit PRIVATE
  -fno-exceptions
  -fno-rtti
  -Wall
  -Wextra
  -Werror
)
