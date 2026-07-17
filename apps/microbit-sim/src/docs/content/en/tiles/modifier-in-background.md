```brain noframe do
{ "tile": "tile.modifier->microbit-v2.in-background" }
```

# In background

Shows on the display without making the rule wait.

---

Attach to `tile:tile.actuator->microbit-v2.display-scroll` or
`tile:tile.actuator->microbit-v2.draw-image`: the animation runs as usual, but
the rule continues at once instead of waiting for it to finish. The display
stays busy until the animation completes, so a new request during that time is
still dropped.
