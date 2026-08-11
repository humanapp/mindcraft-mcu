```brain noframe do
{ "tile": "tile.out->buffer:<buffer>.value" }
```

# The received bytes

The raw bytes that just arrived over radio, for the rule that received it to use.

---

Place `tile:tile.out->buffer:<buffer>.value` in the rule whose WHEN is
`tile:tile.sensor->microbit-v2.radio-receive-buffer`, or in any rule below it:
it reads the buffer that packet carried. It only has a value on the thinks a
buffer packet arrived.

## See Also

`tile:tile.sensor->microbit-v2.radio-receive-buffer`
`tile:tile.out->number:<number>.rssi`
