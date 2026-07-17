```brain noframe do
{ "tile": "tile.modifier->microbit-v2.immediately" }
```

# Immediately

Takes over the display at once.

---

Attach to `tile:tile.actuator->microbit-v2.display-scroll` or
`tile:tile.actuator->microbit-v2.draw-image`: whatever the display is showing
is stopped and this one starts now. Without it, a request made while the
display is busy is dropped.
