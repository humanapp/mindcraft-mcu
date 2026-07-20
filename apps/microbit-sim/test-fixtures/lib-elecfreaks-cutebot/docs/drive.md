```brain noframe do
{ "tile": "${tileId}" }
```

# Cutebot drive

Drives the Cutebot straight.

---

Drives both wheels at the normal rate; add up to three `slowly` or `quickly`
words to change the speed, and `backward` to reverse. A rule keeps the robot
moving by firing every think: when no movement rule fires for a few thinks,
the robot stops. Movement tiles firing together blend into one motion, and
`cutebot stop` overrides them all.
