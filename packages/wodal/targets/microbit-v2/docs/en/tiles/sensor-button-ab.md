```brain noframe when
{ "tile": "tile.sensor->microbit-v2.button-ab" }
```

# Button A+B

True when buttons A and B are used together.

---

Works like `tile:tile.sensor->microbit-v2.button-a`, but the press only counts
while **both** buttons are down at the same time. It takes the same optional
event modifiers: `tile:tile.modifier->microbit-v2.pressed` (the default),
`tile:tile.modifier->microbit-v2.released`,
`tile:tile.modifier->microbit-v2.click`,
`tile:tile.modifier->microbit-v2.double-click`,
`tile:tile.modifier->microbit-v2.long-click`, and
`tile:tile.modifier->microbit-v2.held`.
