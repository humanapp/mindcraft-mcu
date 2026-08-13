```brain noframe when
{ "tile": "${tileId}" }
```

# Radio receive buffer

Fires when a buffer of raw bytes arrives over radio.

---

Delivers the next unread buffer packet, one per think, oldest first; the
received bytes are the tile's result, and the packet also fills the
`received value` and `signal strength` output tiles for the DO side. Buffers
carry custom packet formats, such as the gamepad state packet a library
decodes. Both micro:bits must be on the same radio group (see
`tile:tile.actuator->microbit-v2.set-radio-group`).
