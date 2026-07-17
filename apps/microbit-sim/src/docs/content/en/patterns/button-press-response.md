# Respond to a Button Press

Patterns are reusable rule shapes you can adapt to your own brain. Each pattern
page shows a complete rule; use the **Copy** button to copy it, paste it into
the brain editor, then swap tiles to fit your project.

This one is the most common shape on the micro:bit: when a button is pressed,
show something on the display.

## Rules

```brain
{
  "ruleJsons": [
    {
      "version": 1,
      "when": [
        "tile.sensor->microbit-v2.button-a",
        "tile.modifier->microbit-v2.pressed"
      ],
      "do": [
        "tile.actuator->microbit-v2.display-scroll",
        "tile.literal->string:<string>->hi"
      ],
      "children": []
    }
  ],
  "catalog": [
    {
      "version": 2,
      "kind": "literal",
      "tileId": "tile.literal->string:<string>->hi",
      "valueType": "string:<string>",
      "value": "hi",
      "valueLabel": "hi",
      "displayFormat": "default"
    }
  ]
}
```

## See Also

`tile:tile.sensor->microbit-v2.button-a`
`tile:tile.modifier->microbit-v2.pressed`
`tile:tile.actuator->microbit-v2.display-scroll`
