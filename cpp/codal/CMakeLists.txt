# The CODAL-common, board-agnostic runtime layer: the host-loop driver and the
# device fault-mode policy. Depends on core only; board specifics are forbidden
# (enforced by check-deps.sh). Builds with exceptions and RTTI off, matching
# core; error propagation is by Status/Result return values.
add_library(wendoo-codal STATIC
  fault-mode.cpp
  host-loop.cpp
  on-flash-region.cpp
)

target_link_libraries(wendoo-codal PUBLIC wendoo-core)

target_compile_options(wendoo-codal PRIVATE
  -fno-exceptions
  -fno-rtti
  -Wall
  -Wextra
  -Werror
)
