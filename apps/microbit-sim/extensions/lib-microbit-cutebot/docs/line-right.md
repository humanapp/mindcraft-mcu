```brain noframe when
{ "tile": "${tileId}" }
```

# Cutebot line (right)

Reads the right line-tracking sensor.

---

True while the right downward-facing sensor is over a dark line (the default,
also selectable as `on`). The optional word changes what it reports: `found`
is true only on the think the sensor crosses onto the line, and `lost` only on
the think it leaves it.
