# Voxel Builder — asset viewer

Procedural heightmaps are generated from each block texture at runtime; no
ready-made PBR/heightmap assets and no normal-map textures are used.

**Toggle:** in the **Settings** menu, the `Heightmaps: On/Off` button (or `H`)
switches the heightmap shading live. The choice is stored in `localStorage`; the
default comes from `viewer/config.json` -> `render.heightMap`.

**Algorithm** (`index.html`, "PROCEDURAL HEIGHT MAPS"):

1. Read the albedo texture and collect every unique opaque RGB colour in the
   frame. Transparent cutout pixels are excluded.
2. Compare all of those colours against each other, sorted globally by Rec. 709
   luminance. Each colour gets a rank in that palette, so identical colours
   always get identical depth and rare colours keep their true rank.
3. Map each pixel to its colour's rank in 0..1, apply gamma, and optionally
   quantize the result into flat height levels. No neighbouring pixels are
   compared when defining depth; the darkest colour is the lowest and the
   brightest is the highest (no inversion).
4. The shader consumes that heightmap, not a normal-map image:
   - tangent-space normals are derived from height differences in the fragment
     shader;
   - a crisp edge term adds a thin highlight on the side of each height step
     whose surface normal faces the light, and a shadow on the opposite side
     ("outlined" relief). A height rise is lit where the gradient points away
     from the light, so dark mortar lines stay recessed. The time-of-day
     sun/moon direction is converted per face in the vertex shader using
     per-face tangent/bitangent attributes; the fragment only does one dot.
     There is no per-fragment world-to-tangent light transform;
   - low areas are darkened with a height cavity/AO term.
   The height field is expanded to 256x with nearest-neighbour steps, so the
   bevels stay crisp at screen resolution instead of being smoothed. The
   heightmap edges are matched (periodic) so same-texture blocks meet without a
   seam, and a per-vertex `faceScale` keeps the bevel width constant on slabs,
   stairs and other non-unit faces. The WebGL canvas renders at up to 3x device
   pixel ratio for the same reason.
5. Animated textures (vertical frame strips such as lava, magma, sculk,
   lanterns and command blocks) get a separate height field for every frame.
   The frames are stored left-to-right in one horizontal atlas, and the shader
   selects the atlas cell matching the current albedo frame (`uHeightFrames`).
6. Everything is surface shading only. Block geometry is not displaced or
   tessellated; there is no real height.

## How RTX / deferred renderers use heightmaps

The reference implementation is Minecraft RTX. A PBR texture set may contain a
`heightmap` layer *or* a `normal` layer, but not both; the heightmap is a
single-channel image. In NVIDIA's authoring format the red channel stores
height (`1` = protrudes, `0` = recedes, `0.5` = neutral) and green/blue must be
`0`, otherwise the game treats the file as a normal map
([NVIDIA PBR guide](https://www.nvidia.com/en-us/geforce/guides/minecraft-rtx-texturing-guide/),
[Microsoft texture-set docs](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/texturesetsreference/texturesetsconcepts/texturesetsintroduction)).

The engine converts that height field into surface normals (Vanilla RTX, for
example, ships 16x heightmaps and generates 192x normals from them). In a
deferred renderer the geometry pass writes albedo, normal, depth, roughness and
metalness/emissive into the G-buffer; the lighting/ray-tracing pass then shades
using the normal from the G-buffer. The heightmap itself is not a G-buffer
channel and RTX does **not** tessellate or displace the block; the "height"
is a lighting-space normal perturbation.

This viewer is forward-rendered, so it does the same work in the material
fragment shader: sample the heightmap, derive the tangent-space normal from
height differences, and shade with it. That is equivalent to the deferred
G-buffer normal for a single-light scene. The cavity AO and outlined bevel are
viewer-side approximations; no geometry is displaced and there is no parallax
walk. The bevel's light direction is projected into each face's UV space in
the vertex shader from the current sun/moon phase, so it stays light-dependent
without a per-fragment light transform.

Config knobs (`viewer/config.json`):

```json
"render": {
  "heightMap": true,
  "reflections": false,
  "reflectionStrength": 0.5,
  "reflectionType": "normal",
  "heightMapResolution": 256,
  "heightMapLevels": 0,
  "heightMapSeamless": true,
  "heightMapAO": 0.12,
  "heightMapEdge": 0.45,
  "heightMapEdgeThreshold": 0.05,
  "heightMapLift": 0.05,
  "heightMapGamma": 1.0,
  "heightMapNormalStrength": 2.4
}
```

`heightMapResolution` is the per-frame heightmap size: **16, 256 (default), or
512 px**. Animated textures pack one independent height field per frame into a
row-major atlas at the same size, and the shader samples the atlas cell for the
current frame. Higher resolutions use more GPU memory and take longer to build. `heightMapLevels`
quantizes the height field (0 = off), `heightMapSeamless`
matches opposite texture edges for seamless tiling, `heightMapEdge` /
`heightMapEdgeThreshold` control the outlined bevel, `heightMapLift` adds a
small overall brightness lift when heightmaps are on, `heightMapAO` is
cavity-darkening strength, and `heightMapNormalStrength` scales the
height-derived normal relief.

Every block surface gets the heightmap, including translucent glass/ice and flat
cutout plants. Static textures use the selected `heightMapResolution`; animated
textures pack one independent height field per frame into a row-major atlas at
the same per-frame size, and the shader samples the atlas cell for the current
frame.

The toggle removes the whole heightmap shading pass. Running the heightmap
pipeline needs nothing beyond the existing albedo files.

## Reflections

**Reflections** (first item in Settings) cycles `Off → Normal → Flat`. It enables
real-time cube-map reflections on **every block side**. Each material keeps a
per-texel reflection mask sampled as Three.js' Lambert `specularMap`: the albedo
alpha channel is the map, so opaque texels reflect and transparent cutout pixels
do not. Translucent sides (water, ice, glass) use a fully white mask, which
reflects the whole side. The material class only tunes the overall strength
(stone ~0.2, ice/glass/metal ~0.5-0.7); the per-pixel mask does the pixel-level
selection.

`Normal` mode rebuilds the reflection vector from the per-pixel heightmap normal
(the same normal used for shading), so reflections behave like a normal map and
follow the texture relief. `Flat` mode uses the face normal only. Both are
selected by the `uReflectionMode` uniform; switching modes does not rebuild the
world or recapture the probe. Animated textures use a full-strip alpha mask whose
V offset is kept in sync with the albedo frame.

A 128px `CubeCamera` probe renders the sky every 0.35 s while reflections are on.
**Blocks, stars and the sun/moon are excluded from the sky probe**:
`worldGroup`, `starContainer`, `sunMesh` and `moonMesh` are hidden during
capture, so only the sky gradient is reflected. The sun and moon are captured by
a second cube probe every 0.1 s against a black background, and the two maps are
added in the material shader, so the celestial bodies move without forcing a sky
update. Stars are never reflected. Two cube targets per probe ping-pong: the
scene is captured into one while materials still sample the other, avoiding a
WebGL feedback loop. Turning reflections off sets `uReflectionStrength` to zero
and stops both captures, so there is no world rebuild. The feature is off by
default because
each capture is six extra scene renders; the config defaults are
`render.reflections` and `render.reflectionType`.

## Settings menu

Only **Build** stays in the header. The **Settings** button below it opens a
dropdown containing the field-of-view slider (30-110°), the reflection-strength
slider (0-100%), the heightmap toggle, the heightmap-resolution slider
(16/256/512 px), the reflections mode cycle (Off/Normal/Flat), the
Creative/Orbit camera switch, and Refresh SHA. Clicking outside the menu or
pressing Esc closes it.

The FOV slider applies live to both cameras and is stored in `localStorage`
(`voxelBuilderFov`), overriding `player.fov` from the config on later loads. The
reflection-strength slider scales all reflective materials and is stored in
`voxelBuilderReflectionStrength`; `render.reflectionStrength` sets its initial
value (0.5 = 50% default). The heightmap-resolution slider rebuilds the world
with freshly generated height textures and is stored in
`voxelBuilderHeightMapResolution`.

## Creative movement

The viewer opens in creative first-person mode by default (the last mode is
remembered in `localStorage`). Click the canvas to play — that enters
fullscreen, captures the mouse and locks Ctrl+W/Ctrl+A/Ctrl+D; Esc releases
everything. Use **Camera: Orbit** to go back to the orbit view.

| Input | Action |
| --- | --- |
| `W` `A` `S` `D` | walk / strafe |
| `Ctrl` (hold) | sprint while moving forward |
| `Space` | jump; while flying, fly up |
| `Shift` | sneak; while flying, fly down |
| double-tap `Space` | toggle creative flight (landing also cancels it) |
| double-tap `W` | sprint without holding Ctrl; also works in flight |
| `R` | respawn at the centre above the build |
| `Esc` | release the mouse and browser shortcuts |

Ctrl+W is a browser-reserved shortcut. Capturing it (and Ctrl+A select-all and
Ctrl+D bookmarks) uses the Keyboard Lock API, which Chrome only enables in
fullscreen, so clicking the canvas enters fullscreen, captures the mouse, and
locks `W`/`A`/`D`/Ctrl. Windows' Meta key is deliberately left unlocked so
Win+Shift+S (Snipping Tool) still reaches the OS; Cmd sprinting remains locked on
macOS. Ctrl/Cmd+S is prevented everywhere so it cannot open the browser save
dialog. If the browser denies the lock, Ctrl falls back to double-tap `W`
sprinting. Releasing the mouse (Esc) releases the keyboard lock too.
Movement is simulated at 20 ticks/second with render interpolation, using the
Java Edition constants:

| Mode | Acceleration | Drag | Terminal speed |
| --- | --- | --- | --- |
| walk | 0.098 | 0.546 | 4.317 m/s |
| sprint | 0.1274 | 0.546 | 5.612 m/s |
| sneak | 0.0294 | 0.546 | 1.295 m/s |
| fly | 0.049 | 0.91 | 10.89 m/s |
| sprint-flight | 0.098 | 0.91 | 21.78 m/s |

Gravity is 0.08 per tick with 0.98 vertical drag (terminal -3.92), jump velocity
is 0.42 (1.2522 blocks high) with the 0.2 sprint-jump boost, flight has a 0.15
vertical impulse with 0.6 drag, and the player auto-steps up 0.6 blocks. The
hitbox is 0.6x1.8 (1.5 when sneaking) with a 1.62 eye height (1.27 sneaking).
The crouch eye-height transition is smoothed at render rate instead of ticking
in 20 Hz steps. Sneaking backs away from ledges, and the FOV widens while flying
and sprinting.

Block collision uses the block model element boxes, so slabs, stairs, fences,
walls, panes, chests and similar partial blocks have the right shape; plants,
liquids, torches and rails are non-solid. Full cubes are stored in a Set and
partial shapes in a Map, both rebuilt with the geometry. Fluid swimming and
ladder climbing are not implemented yet.

Config (`viewer/config.json` -> `player`):

```json
"player": {
  "fov": 70,
  "mouseSensitivity": 0.5,
  "startFlying": true
}
```

`mouseSensitivity` uses the same 0-1 scale as Minecraft (0.5 = default);
`startFlying` controls whether `R`/entry starts airborne. `fov` is the initial
field of view; the Settings slider overrides it and is remembered separately.

## Sun and moon

The celestial quads use the vanilla 32x textures with nearest filtering. Their
alpha is derived from the texture luminance with a black cutout threshold, so
the moon phases stay opaque instead of letting dark maria turn translucent.
They are positioned in a world-space circle around the camera (so they stay at
infinity as you move) and are always visible; depth testing still lets terrain
occlude them. Additive blending with a luminance alpha removes the black
texture background without a dark square or edge halo. The sun and moon are
opposite each other; the moon advances through the eight vanilla phase
textures once per day. In the reflection probe they are hidden whenever their
center is below the camera horizon; the real sky still draws them normally.

## TODO

Currently broken or missing
1. Block entities with no JSON geometry
These still render as stone-textured cubes or empty:

Chests, trapped chests, ender chests

Beds

Signs (standing, wall, hanging)

Banners

Shulker boxes

Bells (we saw this earlier)

Lecterns, campfires with items, decorated pots, etc.

They need either custom geometry in your repo (like we did for end_portal.json), or viewer-side special handling that reads their underlying *_template.json (most exist, but many have no elements because they're block-entity rendered).

2. Render modes
Right now every face uses alphaTest: 0.5 and DoubleSide. That's wrong for:

Translucent blocks: water, glass, ice, slime, honey, stained glass. They should use transparent: true with no alphaTest, and ideally sorted for depth.

Cutout-mipless blocks: leaves, saplings, flowers. Leaves are alpha-cutout and
excluded from opaque face culling, so blocks behind leaf holes stay visible.

Entity solid: chests, signs. Should use alphaTest: 0.1 (they don't have transparency).

Vanilla declares this in the model's render_type field (1.21+) or via hardcoded mappings. We can read the field or maintain a set of block-name prefixes.

3. Water and lava fluids
Fluids now get a synthetic full-cube fallback model using `water_still` / `lava_still` (water tinted blue and translucent, lava opaque). Faces between adjacent fluid cells are culled so pools do not double-blend. Still missing: the lowered fluid top surface, flowing direction based on neighbours, and special side textures in some states.

Shader-based blocks we haven't integrated
4. Beacon beam — a vertical column with rendertype_beacon_beam. Self-contained, similar to the end portal.

5. Glint overlay — the enchantment shimmer. Renders on top of items and some blocks.

6. Conduit — swirling water sphere, also shader-driven.

7. Cloud/sky — if you ever want a scene background.

Shape edge cases
8. Rotated cross models — torches, ladders, rails, tripwire, vines, chains. They mostly work already, but placement rotation (from facing) sometimes doubles up with the model rotation.

9. Redstone — dust connections, repeaters, comparators. Lots of tiny directional variants.

10. Doors, trapdoors, fence gates — open/closed states, hinge sides.

11. Custom tints per biome — grass/foliage colormaps are sampled with fixed
plains temperature/humidity. Without biome data this is a reasonable fixed
plains tint, not a per-position one.

Quality of life
12. URL sharing — encode the commands in location.hash so a link reproduces the scene.

13. Screenshot button — canvas.toDataURL, quick win.

14. Texture atlas — one big atlas instead of hundreds of individual PNG requests. Faster first load, fewer draw calls.

15. Sky background — a gradient or a cubemap instead of solid #071014. Simple but makes screenshots look nicer.

16. Merged geometry per block — currently every face is its own mesh. For a 20×20 fill that's thousands of meshes. Batching by material would be a nice perf upgrade.

17. Import/export world — copy-paste command sets to/from a text file.

Command parsing
18. /setblock … replace|keep|destroy — currently ignores the mode argument.

19. Block predicates in /fill … replace — no filter support.

20. Coordinates relative to origin (~) — not parsed.

21. /clone, /execute — bigger scope.
