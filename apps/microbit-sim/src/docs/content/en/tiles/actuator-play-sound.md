```brain noframe do
{ "tile": "tile.actuator->microbit-v2.play-sound" }
```

# Play sound

Plays a built-in sound on the speaker.

---

Plays the given `tile:tile.parameter->microbit-v2.sound-emoji`, a built-in
sound such as `tile:tile.literal->struct:<SoundEmoji>->twinkle`. With no sound
it plays `tile:tile.literal->struct:<SoundEmoji>->hello`. The rule waits until
the sound finishes, and a play made while the speaker is busy is dropped; add
`tile:tile.modifier->microbit-v2.immediately` to take over the speaker at
once, or `tile:tile.modifier->microbit-v2.in-background` to let the rule
continue without waiting.
