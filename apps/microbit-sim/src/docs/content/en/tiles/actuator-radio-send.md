```brain noframe do
{ "tile": "${tileId}" }
```

# Radio send

Broadcasts a value to every micro:bit on the same radio group.

---

Sends a number, text, true/false, or a buffer over radio; with no argument it
sends the value the WHEN side produced. A true/false is sent as the number 1
or 0. The receiving micro:bit reads it with the matching radio receive tile and
must be on the same group (see
`tile:tile.actuator->microbit-v2.set-radio-group`).
