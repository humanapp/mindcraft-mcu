```brain noframe do
{ "tile": "${tileId}" }
```

# Cutebot stop

Stops the Cutebot at once.

---

Stops both wheels immediately. A stop wins over every other movement tile that
fires in the same think, so use it for safety rules that must always take
effect. Movement resumes normally on the next think.
