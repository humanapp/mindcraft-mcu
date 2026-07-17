```brain noframe when
{ "tile": "${tileId}" }
```

# Stick

Reads the thumb stick as a direction.

---

True while the stick is pushed in one of the named directions. Add any of the
`up`, `down`, `left`, `right` words to pick directions; with none, the tile is
true for any direction. A stick that is pressed straight in reports no
direction, so every direction reads false while it is pressed.
