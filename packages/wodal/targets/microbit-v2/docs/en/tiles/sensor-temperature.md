```brain noframe when
{ "tile": "${tileId}" }
```

# Temperature

The temperature of the micro:bit, in degrees Celsius. It can be negative when
the board is cold.

---

Reads the micro:bit's own temperature each think and reports it as a whole
number of degrees Celsius. On the **WHEN** side it is true whenever the reading
is not 0, so it fires at any normal room temperature. The reading is the tile's
result, and also fills the `value` output tile for the DO side, so you can
compare it against a threshold, for example to react only when the board gets
warm.
