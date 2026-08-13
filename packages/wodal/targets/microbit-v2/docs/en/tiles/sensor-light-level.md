```brain noframe when
{ "tile": "${tileId}" }
```

# Light level

The ambient light shining on the display, from 0 (dark) to 255 (bright).

---

Reads the light falling on the LED matrix each think and reports it as a number
from 0 to 255. On the **WHEN** side it is true whenever the reading is above 0,
so any light makes it fire. The reading is the tile's result, and also fills the
`value` output tile for the DO side, so you can compare the brightness against a
threshold, for example to react only when the room goes dark.
