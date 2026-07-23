#pragma once

#include <cstdint>

#include "core/platform/span.h"
#include "core/runtime/execution-context.h"
#include "core/runtime/handle-table.h"
#include "core/runtime/result.h"
#include "core/runtime/value.h"
#include "targets/microbit-v2/abi/host-actions/actuators/play-sound.h"
#include "targets/microbit-v2/abi/host-functions/native-receiver.h"
#include "targets/microbit-v2/abi/type-atom-id.h"

namespace mindcraft
{

/**
 * Positional arg slot of the `MicroBitAudio.playSound` host function: arg 0 is
 * the audio receiver, arg 1 the built-in sound name.
 */
inline constexpr uint32_t kAudioPlaySoundHostFnNameArgSlot = 1;

/**
 * Arg slot of the optional `PlaySoundOptions` struct, and its field ids: the
 * `immediately` flag preempts the current lease at dispatch, `inBackground`
 * resolves the handle at dispatch so the caller does not await the play. Both
 * default false when the struct or the field is absent.
 */
inline constexpr uint32_t kAudioPlaySoundHostFnOptionsArgSlot = 2;
inline constexpr uint32_t kPlaySoundOptionsImmediatelyField = 0;
inline constexpr uint32_t kPlaySoundOptionsInBackgroundField = 1;

/**
 * Async host function `MicroBitAudio.playSound`: play the built-in sound named
 * by the string argument on the speaker. Arg 0 is the audio receiver, arg 1
 * the name (a non-string or absent argument reads as an empty name, which the
 * speaker treats as a name outside the built-in set), arg 2 the optional
 * `PlaySoundOptions` struct carrying the `immediately` and `inBackground` flags
 * (both default false when the struct or a field is absent). When `immediately`
 * is true the current speaker lease is preempted at dispatch, before the name
 * is examined, so an unknown name still preempts.
 * Starts the play on the speaker port at the current think time and leaves
 * `handle` for the port to settle: an accepted play takes the speaker lease and
 * resolves once its nominal duration elapses, a play the busy speaker drops or
 * an unknown name resolves at once. When `inBackground` is true the sound keeps
 * its lease but `handle` resolves at dispatch, so the caller continues this
 * round without parking on the playback. An unrecognized receiver resolves the
 * handle at once. `hostData` is the bound {@link MicroBitV2PlaySoundEnv}.
 * Mirrors the `MicroBitAudio.playSound` host function in
 * packages/wodal/src/targets/microbit-v2/mindcraft/module.ts.
 */
inline Status execAudioPlaySoundHostFn(void *hostData, ExecutionContext &ctx,
                                       Span<const Value> args, AsyncHandle handle)
{
    MicroBitV2PlaySoundEnv &env = *static_cast<MicroBitV2PlaySoundEnv *>(hostData);
    if (args.empty() || !detail::isReceiver(args[0], MicroBitV2TypeAtomId::MicroBitAudio))
    {
        handle.resolve(kVoidValue);
        return Status::ok();
    }
    const char *bytes = "";
    uint32_t length = 0;
    if (kAudioPlaySoundHostFnNameArgSlot < args.size() &&
        args[kAudioPlaySoundHostFnNameArgSlot].isString())
    {
        const char *argBytes = nullptr;
        uint32_t argLength = 0;
        if (env.heap->stringContent(args[kAudioPlaySoundHostFnNameArgSlot], argBytes, argLength))
        {
            bytes = argBytes;
            length = argLength;
        }
    }
    if (optionStructFlag(*env.heap, args, kAudioPlaySoundHostFnOptionsArgSlot,
                         kPlaySoundOptionsImmediatelyField))
    {
        env.speaker->preempt();
    }
    env.speaker->playSoundEmoji(reinterpret_cast<const uint8_t *>(bytes), length, ctx.time, handle);
    if (optionStructFlag(*env.heap, args, kAudioPlaySoundHostFnOptionsArgSlot,
                         kPlaySoundOptionsInBackgroundField))
    {
        // The sound keeps its lease and resolves on tick time as above;
        // resolving now releases the caller so it does not park.
        handle.resolve(kVoidValue);
    }
    return Status::ok();
}

} // namespace mindcraft
