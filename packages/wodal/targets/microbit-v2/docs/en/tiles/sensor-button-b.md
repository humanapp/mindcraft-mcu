```brain noframe when
{ "tile": "${tileId}" }
```

# Button B

True when something happens on button B.

---

Place on the **WHEN** side to react to button B. The optional modifier picks the
event: `tile:tile.modifier->microbit-v2.pressed` (the default) fires on the think
the button goes down, `tile:tile.modifier->microbit-v2.released` when it comes
back up, `tile:tile.modifier->microbit-v2.click` after a short press,
`tile:tile.modifier->microbit-v2.double-click` on two quick presses,
`tile:tile.modifier->microbit-v2.long-click` after a press held for a second or
more, and `tile:tile.modifier->microbit-v2.held` is true the whole time the
button is down.
