# Reproducible device build. Build context is the cpp/ directory (this image
# compiles cpp/core/ into the firmware), so run from cpp/:
#
#   docker build -f targets/microbit-v2/Dockerfile --output out/microbit-v2 .
#
# The hex lands in cpp/out/microbit-v2/.
FROM ubuntu:22.04 AS builder

RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends \
      ca-certificates curl bzip2 git make cmake ninja-build python3 && \
    apt-get clean -y && \
    rm -rf /var/lib/apt/lists/*

# Pinned GNU Arm Embedded toolchain 10.3-2021.10.
ARG TARGETARCH
RUN case "${TARGETARCH}" in \
      amd64) \
        GCC_ARM_ARCH="x86_64"; \
        GCC_ARM_SHA256="97dbb4f019ad1650b732faffcc881689cedc14e2b7ee863d390e0a41ef16c9a3" ;; \
      arm64) \
        GCC_ARM_ARCH="aarch64"; \
        GCC_ARM_SHA256="f605b5f23ca898e9b8b665be208510a54a6e9fdd0fa5bfc9592002f6e7431208" ;; \
      *) echo "unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
    esac && \
    curl -fsSL -o /tmp/gcc-arm.tar.bz2 \
      "https://developer.arm.com/-/media/Files/downloads/gnu-rm/10.3-2021.10/gcc-arm-none-eabi-10.3-2021.10-${GCC_ARM_ARCH}-linux.tar.bz2" && \
    echo "${GCC_ARM_SHA256}  /tmp/gcc-arm.tar.bz2" | sha256sum -c - && \
    mkdir -p /opt/gcc-arm-none-eabi && \
    tar -xjf /tmp/gcc-arm.tar.bz2 -C /opt/gcc-arm-none-eabi --strip-components=1 && \
    rm /tmp/gcc-arm.tar.bz2

ENV PATH="/opt/gcc-arm-none-eabi/bin:${PATH}"

COPY . /opt/mindcraft-cpp
WORKDIR /opt/mindcraft-cpp/targets/microbit-v2

RUN python3 build.py

# Emit the build->patcher metadata (region offset/size from the linked ELF
# symbols, firmware id, on-flash format) alongside the hex (Phase 5a).
RUN python3 tools/emit-metadata.py

# Export the dual artifact: the hex plus its metadata. (The .bin generator spans
# the flash + UICR regions and emits a uselessly padded multi-hundred-MB file;
# DAPLink flashing takes the hex.)
FROM scratch AS export-stage
COPY --from=builder /opt/mindcraft-cpp/targets/microbit-v2/MICROBIT.hex .
COPY --from=builder /opt/mindcraft-cpp/targets/microbit-v2/MICROBIT.metadata.json .
