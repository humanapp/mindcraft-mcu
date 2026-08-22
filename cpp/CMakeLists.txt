cmake_minimum_required(VERSION 3.21)

project(wendoo-cpp LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)
set(CMAKE_CXX_FLAGS_DEBUG "-g -O0")

option(MC_SANITIZE "Build with AddressSanitizer and UndefinedBehaviorSanitizer" OFF)
if(MC_SANITIZE)
  add_compile_options(-fsanitize=address,undefined -fno-omit-frame-pointer
                      -fno-sanitize-recover=all)
  add_link_options(-fsanitize=address,undefined)
endif()

enable_testing()

add_subdirectory(core)
add_subdirectory(hostkit)
add_subdirectory(codal)
add_subdirectory(test)
