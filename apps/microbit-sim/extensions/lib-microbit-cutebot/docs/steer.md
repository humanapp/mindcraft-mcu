```brain noframe do
{ "tile": "${tileId}" }
```

# Cutebot steer

Drives the Cutebot from a position value.

---

Takes a position (both axes -100..100): its `y` axis (up positive) drives
forward or backward and its `x` axis (right positive) turns. Feed it the
gamepad `stick position` or `decoded stick position` to drive the robot from a
controller.
