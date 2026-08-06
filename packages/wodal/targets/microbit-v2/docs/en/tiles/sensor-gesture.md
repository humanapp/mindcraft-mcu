```brain noframe when
{ "tile": "tile.sensor->microbit-v2.gesture" }
```

# Gesture

True while the micro:bit is in the selected motion or orientation.

---

Reads the accelerometer and is true while the current gesture matches the
selected modifier word; with no word it detects
`tile:tile.modifier->microbit-v2.shake`. The words are
`tile:tile.modifier->microbit-v2.shake`,
`tile:tile.modifier->microbit-v2.tilt-up`,
`tile:tile.modifier->microbit-v2.tilt-down`,
`tile:tile.modifier->microbit-v2.tilt-left`,
`tile:tile.modifier->microbit-v2.tilt-right`,
`tile:tile.modifier->microbit-v2.face-up`,
`tile:tile.modifier->microbit-v2.face-down`, and
`tile:tile.modifier->microbit-v2.freefall`.
