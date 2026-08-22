#include "doctest/doctest.h"

#include "fixture-paths.h"

#include <fstream>
#include <string>
#include <vector>

namespace {

std::vector<char> readBinaryFile(const std::string& path) {
  std::ifstream stream(path, std::ios::binary);
  REQUIRE_MESSAGE(stream.good(), "cannot open ", path);
  return std::vector<char>(std::istreambuf_iterator<char>(stream),
                           std::istreambuf_iterator<char>());
}

} // namespace

TEST_CASE("core fixture root resolves to committed binary fixtures") {
  std::string path = std::string(wendoo::test::kCoreFixturesDir) + "/control-flow.mcprogram.bin";
  std::vector<char> bytes = readBinaryFile(path);
  CHECK(bytes.size() > 0);
}

TEST_CASE("wodal fixture root resolves to committed binary fixtures") {
  std::string path = std::string(wendoo::test::kWodalFixturesDir) + "/button-display.mcprogram.bin";
  std::vector<char> bytes = readBinaryFile(path);
  CHECK(bytes.size() > 0);
}
