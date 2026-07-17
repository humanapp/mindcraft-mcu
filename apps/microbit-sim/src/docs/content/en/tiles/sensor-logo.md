```brain noframe when
{ "tile": "tile.sensor->microbit-v2.button-logo" }
```

# Logo

True when the touch logo is touched.

---

The gold logo on the front of the micro:bit is touch sensitive and behaves like
a third button. It takes the same optional event modifiers as
`tile:tile.sensor->microbit-v2.button-a`:
`tile:tile.modifier->microbit-v2.pressed` (the default),
`tile:tile.modifier->microbit-v2.released`,
`tile:tile.modifier->microbit-v2.click`,
`tile:tile.modifier->microbit-v2.double-click`,
`tile:tile.modifier->microbit-v2.long-click`, and
`tile:tile.modifier->microbit-v2.held`.
