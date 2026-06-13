# The desktop host test harness. Builds with exceptions enabled (doctest's
# assertion machinery requires them) while linking the exception-free core.
add_executable(mindcraft-tests
  main.cpp
  brain-runtime.test.cpp
  byte-cursor.test.cpp
  bytecode.test.cpp
  context-field.test.cpp
  core-func-id.test.cpp
  core-host-actions.test.cpp
  core-type-atom-id.test.cpp
  device-port.test.cpp
  error-code.test.cpp
  fiber-scheduler.test.cpp
  fixture-paths.test.cpp
  host-loop.test.cpp
  load-error.test.cpp
  microbit-v2-abi.test.cpp
  observable-trace.test.cpp
  pool.test.cpp
  program-dump.test.cpp
  program-reader.test.cpp
  program.test.cpp
  region-arena.test.cpp
  result.test.cpp
  span.test.cpp
  trace-parity.test.cpp
  value.test.cpp
  vm.test.cpp
)

# mindcraft-codal links mindcraft-core PUBLIC, so the core library and its
# include paths reach the tests transitively.
target_link_libraries(mindcraft-tests PRIVATE mindcraft-codal)

target_include_directories(mindcraft-tests PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
target_include_directories(mindcraft-tests SYSTEM PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/vendor)

target_compile_options(mindcraft-tests PRIVATE -Wall -Wextra -Werror)

# Fixture roots for parity tests, resolved relative to cpp/ inside the repo.
get_filename_component(MC_REPO_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../.." ABSOLUTE)
target_compile_definitions(mindcraft-tests PRIVATE
  MC_CORE_FIXTURES_DIR="${MC_REPO_ROOT}/external/mindcraft-lang/packages/core/src/runtime/__fixtures__"
  MC_WODAL_FIXTURES_DIR="${MC_REPO_ROOT}/packages/wodal/src/targets/microbit-v2/mindcraft/__fixtures__"
)

add_test(NAME mindcraft-tests COMMAND mindcraft-tests)
