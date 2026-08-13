```brain noframe do
{ "tile": "${tileId}" }
```

# The signal strength

How strong the radio signal was for the message that just arrived, as a number
at or below zero: nearer zero is a stronger signal.

---

Place `tile:tile.out->number:<number>.rssi` in a rule whose WHEN is any of the
radio receive tiles, or in any rule below it. On a real micro:bit the number
drops further below zero as the sender gets further away, so comparing it
against a number tells a close sender from a distant one. The simulator has no
real signal and reports the same strength for every message.

## See Also

`tile:tile.sensor->microbit-v2.radio-receive-number`
`tile:tile.out->number:<number>.value`
