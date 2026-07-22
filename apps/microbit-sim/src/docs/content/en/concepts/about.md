# Mindcraft micro:bit Simulator

A browser-based simulator for the BBC micro:bit -- program its brain with tiles, watch it run in the simulator, then flash the same program onto a real board.

Each brain is built from tiles -- visual blocks that read sensors, react to events, and drive the display, speaker, and radio. Edit a brain and the simulator reflects your changes immediately.

## What does a brain look like?

A brain is a list of rules. Each rule has a **WHEN** side (conditions) and a **DO** side (actions). Here is a rule that shows a heart when button A is pressed:

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
        "tile.actuator->microbit-v2.draw-image",
        "tile.literal->struct:<Image>->heart"
      ],
      "children": []
    }
  ],
  "catalog": []
}
```

Rules are evaluated top-to-bottom. Place more specific rules above more general ones so they take priority.

## Getting started

1. **Add a brain.** Use the **+** button in the brain list to create one.
2. **Edit a brain.** Click **Edit Brain** to open the Brain Editor, add tiles to build rules, then close the editor to apply your changes.
3. **Watch it run.** The simulator panel runs the brain live as you edit it.
4. **Flash a real board.** Connect a micro:bit over WebUSB, or download a `.hex` file, to run the same program on hardware.

## Tips

- Use the docs panel (the book icon) to learn about individual tiles and rule patterns.
- Write custom tiles in TypeScript over the VS Code Bridge -- see **Connect VS Code** in this panel.
