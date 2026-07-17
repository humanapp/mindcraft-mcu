```brain noframe when
{ "tile": "tile.sensor->microbit-v2.radio-receive-number" }
```

# Radio receive number

Fires when a number arrives over radio.

---

Delivers the next unread number packet, one per think, oldest first; the
received number is the tile's result, and the packet also fills the
`received value` and `signal strength` output tiles for the DO side. A received
0 still fires the rule. Both micro:bits must be on the same radio group (see
`tile:tile.actuator->microbit-v2.set-radio-group`).
