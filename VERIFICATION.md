# Verification — Minecraft 26.3 UI

## Version lock

Minecraft Java Edition `26.3` (latest release at implementation time).

## Source hashes

See [`SOURCE.md`](SOURCE.md). GUI backgrounds and `textures/font/ascii.png` are byte-identical to the 26.3 client jar. `font/include/default.json` was restored from the jar after a mismatched repository copy was found.

`glyph_sizes.bin` does not exist in the 26.3 client assets. Glyph advances are measured from the alpha bounds of `ascii.png`:

- advance = rightmost opaque column + 2
- space = 4
- expected total advance for `abcdefghijklmnopqrstuvwxyz0123456789` = **205 logical pixels**

## Layout contract

The canvas renderer uses `CREATIVE_LAYOUTS` as its only coordinate source:

- creative panel: `195 × 136`
- slot grid: `9 × 5`, origin `(9, 18)`, slot `18`
- hotbar: origin `(9, 112)`
- search: `(82, 6, 80, 9)`
- scrollbar: `(175, 18, 12, 112)`, thumb `12 × 15`
- tabs: `26 × 32`, spacing `27`
- standard inventory: `176 × 166`
- inventory player: `(26, 8, 49 × 70)`
- crafting grid: `(98, 18)`, result `(154, 28)`
- inventory main: `(8, 84)`, hotbar `(8, 142)`

The canvas transform is `scale(scale, scale)` with no browser layout or CSS positions for slots.

## Scale

Auto scale:

```text
max(1, min(floor(windowWidth / 320), floor(windowHeight / 240)))
```

Manual override: `window.setCreativeGuiScale(n)`.

Screenshots captured at scale 1, 2 and 3:

- `C:\Users\save_\AppData\Local\Temp\mcv\canvas_scale1.png`
- `C:\Users\save_\AppData\Local\Temp\mcv\canvas_scale2.png`
- `C:\Users\save_\AppData\Local\Temp\mcv\canvas_scale3.png`

## Reference client

A real Minecraft 26.3 client was launched against a local flat creative server and connected successfully using the NVIDIA renderer. It was not a browser approximation.

Reference capture is **not yet accepted**: the client window was moved offscreen and the process exited before F2/key input produced a screenshot. A hidden desktop or virtual display is required for a stable reference loop.

## Not yet verified

- Pixel diff against real client screenshots.
- Tooltip nine-slice rendering.
- Exact hotbar selector at every scale.
- Full slot/quick-move/crafting behavior.
- Per-glyph assertion inside the browser (the Python/alpha metric is measured; the canvas assertion still needs to be exported).

No claim of completion is made while these remain open.
