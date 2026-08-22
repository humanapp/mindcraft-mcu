#pragma once

#include <cstdint>

#include "codal/device-port.h"
#include "core/platform/span.h"
#include "core/runtime/execution-context.h"
#include "core/runtime/handle-table.h"
#include "core/runtime/managed-heap.h"
#include "core/runtime/result.h"
#include "core/runtime/value.h"
#include "targets/microbit-v2/abi/sound-emoji.h"

namespace wendoo
{

/**
 * Positional arg slot of the play-sound actuator, mirroring the flattened
 * call-definition arg slots of the wodal action source
 * (packages/wodal/src/targets/microbit-v2/wendoo/actions/play-sound.ts).
 * Slot order is the call spec's declaration order and is wire-stable with the
 * compiler's emitted arg buffers.
 */
inline constexpr uint32_t kPlaySoundSoundArgSlot = 0;

/** Arg slot of the `immediately` modifier: when present, the play preempts the current lease. */
inline constexpr uint32_t kPlaySoundImmediatelyArgSlot = 1;

/**
 * Arg slot of the `in background` modifier: when present, the sound keeps its
 * lease but the handle resolves at dispatch so the issuing rule does not await it.
 */
inline constexpr uint32_t kPlaySoundInBackgroundArgSlot = 2;

/**
 * The speaker port and managed heap an async play-sound body reaches: the
 * speaker to start the play, the heap to read the sound argument's `SoundEmoji`
 * struct and its name string. The caller fills both before the binding's first
 * dispatch.
 */
struct MicroBitV2PlaySoundEnv
{
    SpeakerPort *speaker;
    ManagedHeap *heap;
};

/**
 * Async host actuator body: play a built-in sound on the speaker. Reads the
 * optional anonymous `SoundEmoji` argument's name (defaulting to the target
 * default sound when the slot is absent, nil, or not a readable sound value);
 * with the `immediately` modifier present it preempts the current speaker
 * lease at dispatch, before the new play is examined. Starts the play on the
 * speaker port at the current think time and leaves `handle` for the port to
 * settle: an accepted play resolves once its nominal duration elapses, a play
 * the busy speaker drops or an unknown name resolves at once. With the
 * `in background` modifier present the sound keeps its lease but `handle`
 * resolves at dispatch, so the issuing rule continues this round without
 * parking on the playback. `hostData` is the bound
 * {@link MicroBitV2PlaySoundEnv}. Mirrors wodal `actions/play-sound.ts`.
 */
inline Status execPlaySound(void *hostData, ExecutionContext &ctx, Span<const Value> args,
                            AsyncHandle handle)
{
    MicroBitV2PlaySoundEnv &env = *static_cast<MicroBitV2PlaySoundEnv *>(hostData);
    const char *bytes = kSoundEmojiDefaultName;
    uint32_t length = sizeof(kSoundEmojiDefaultName) - 1;
    if (kPlaySoundSoundArgSlot < args.size() && args[kPlaySoundSoundArgSlot].isStruct())
    {
        StructObject *obj = env.heap->structOf(args[kPlaySoundSoundArgSlot]);
        if (obj != nullptr)
        {
            const Value nameValue = env.heap->structGet(obj, kSoundEmojiNameFieldId);
            const char *argBytes = nullptr;
            uint32_t argLength = 0;
            if (nameValue.isString() && env.heap->stringContent(nameValue, argBytes, argLength))
            {
                bytes = argBytes;
                length = argLength;
            }
        }
    }
    if (kPlaySoundImmediatelyArgSlot < args.size() && !args[kPlaySoundImmediatelyArgSlot].isNil())
    {
        env.speaker->preempt();
    }
    env.speaker->playSoundEmoji(reinterpret_cast<const uint8_t *>(bytes), length, ctx.time, handle);
    if (kPlaySoundInBackgroundArgSlot < args.size() && !args[kPlaySoundInBackgroundArgSlot].isNil())
    {
        // The sound keeps its lease and resolves on tick time as above;
        // resolving now releases the issuing rule so it does not park.
        handle.resolve(kVoidValue);
    }
    return Status::ok();
}

} // namespace wendoo
