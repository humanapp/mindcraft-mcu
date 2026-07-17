```brain noframe do
{ "tile": "tile.actuator->microbit-v2.display-set-pixel" }
```

# Set pixel

Sets one LED of the 5x5 display.

---

Lights a single LED. `tile:tile.parameter->microbit-v2.x` picks the column and
`tile:tile.parameter->microbit-v2.y` the row, each 0 to 4 counted from the top
left (default 0); `tile:tile.parameter->microbit-v2.brightness` is 0 (off) to
255 (full, the default). The write is instant and is not blocked by a running
text scroll or image draw.
