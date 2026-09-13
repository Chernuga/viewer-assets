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

Cutout-mipless blocks: leaves, saplings, flowers. Currently look OK but occasionally lose edges.

Entity solid: chests, signs. Should use alphaTest: 0.1 (they don't have transparency).

Vanilla declares this in the model's render_type field (1.21+) or via hardcoded mappings. We can read the field or maintain a set of block-name prefixes.

3. Water and lava fluids
Fluids have:

A lowered top surface (from y=14 to y=16 depending on whether they're a source block)

Flowing animation direction based on neighbors

Internal culling between adjacent water blocks

Special side textures in some states

Currently you'd see a full-height blue cube.

Shader-based blocks we haven't integrated
4. Beacon beam — a vertical column with rendertype_beacon_beam. Self-contained, similar to the end portal.

5. Glint overlay — the enchantment shimmer. Renders on top of items and some blocks.

6. Conduit — swirling water sphere, also shader-driven.

7. Cloud/sky — if you ever want a scene background.

Shape edge cases
8. Rotated cross models — torches, ladders, rails, tripwire, vines, chains. They mostly work already, but placement rotation (from facing) sometimes doubles up with the model rotation.

9. Redstone — dust connections, repeaters, comparators. Lots of tiny directional variants.

10. Doors, trapdoors, fence gates — open/closed states, hinge sides.

11. Custom tints per biome — currently we hardcode plains. In principle we can sample a colormap per world position, but without biome data it's a guess anyway.

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
