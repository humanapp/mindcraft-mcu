```brain noframe when
{ "tile": "${tileId}" }
```

# Decoded stick position

Decodes a received gamepad packet into a position.

---

Use it under a `radio receive buffer` rule: it reads the received bytes
automatically and decodes them into a position (`x` and `y`, both -100..100),
read through the accessor tiles. An invalid or missing packet decodes to
(0, 0), the centered idle stick, so the value is always usable.
