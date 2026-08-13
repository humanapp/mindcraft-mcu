```brain noframe when
{ "tile": "${tileId}" }
```

# Click

Reacts to a short press and release.

---

Attach to a button tile such as `tile:tile.sensor->microbit-v2.button-a`: the
rule fires when the button is released after a press shorter than one second.
A longer press is a `tile:tile.modifier->microbit-v2.long-click` instead.
