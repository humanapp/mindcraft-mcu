```brain noframe do
{ "tile": "tile.out->number:<number>.value" }
```

# The received number

The number that just arrived over radio, for the rule that received it to use.

---

Place `tile:tile.out->number:<number>.value` in the rule whose WHEN is
`tile:tile.sensor->microbit-v2.radio-receive-number`, or in any rule below it:
it reads the number that packet carried. It only has a value on the thinks a
number packet arrived.

## Example

```brain
{
  "ruleJsons": [
    {
      "version": 1,
      "when": [
        "tile.sensor->microbit-v2.radio-receive-number"
      ],
      "do": [
        "tile.actuator->microbit-v2.display-scroll",
        "tile.out->number:<number>.value"
      ],
      "children": [],
      "comment": "Scroll whatever number the other micro:bit sent."
    }
  ],
  "catalog": []
}
```

## See Also

`tile:tile.sensor->microbit-v2.radio-receive-number`
`tile:tile.out->number:<number>.rssi`
