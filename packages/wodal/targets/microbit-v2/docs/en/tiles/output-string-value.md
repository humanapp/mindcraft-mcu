```brain noframe do
{ "tile": "${tileId}" }
```

# The received text

The text that just arrived over radio, for the rule that received it to use.

---

Place `tile:tile.out->string:<string>.value` in the rule whose WHEN is
`tile:tile.sensor->microbit-v2.radio-receive-string`, or in any rule below it:
it reads the text that packet carried. It only has a value on the thinks a text
packet arrived.

## See Also

`tile:tile.sensor->microbit-v2.radio-receive-string`
`tile:tile.out->number:<number>.rssi`
