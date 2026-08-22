# Host-only tooling that renders a decoded program or a VM run as canonical
# text for the parity tests. The device firmware never reads these emitters,
# so they live outside cpp/core (whose tree the firmware build globs whole) and
# are compiled only by this desktop library and the test suite that links it.
# Builds with exceptions and RTTI off to match the core library it renders.
add_library(wendoo-hostkit STATIC
  observable-trace.cpp
  program-dump.cpp
)

target_link_libraries(wendoo-hostkit PUBLIC wendoo-core)

target_compile_options(wendoo-hostkit PRIVATE
  -fno-exceptions
  -fno-rtti
  -Wall
  -Wextra
  -Werror
)
