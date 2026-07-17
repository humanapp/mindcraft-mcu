```brain noframe when
{ "tile": "tile.sensor->microbit-v2.radio-receive-string" }
```

# Radio receive string

Fires when text arrives over radio.

---

Delivers the next unread text packet, one per think, oldest first; the received
text is the tile's result, and the packet also fills the `received value` and
`signal strength` output tiles for the DO side. Empty text still fires the
rule. Both micro:bits must be on the same radio group (see
`tile:tile.actuator->microbit-v2.set-radio-group`).
