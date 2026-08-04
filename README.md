# Play on Mobile

<img width="980" alt="Vagabond companion sheet on a phone, docked beside the live map" src="https://github.com/user-attachments/assets/c04476ad-ff52-4827-8f51-2f9bf43b1f8e" />

*Play the table using gestures you already know:  tap, pan, pinch, long tap*

<img width="980" alt="image" src="https://github.com/user-attachments/assets/e2280697-19b3-4b98-96f2-f9f519eeea30" />

*Works in both portrait and landscape: gives you full room for expanding the sheet while keeping an eye on the map.*

A Foundry VTT module that turns a player's phone into a companion device for the table: a simplified, tap-friendly character sheet docked alongside a live, pannable view of the map.

### Touch gesture equivalents

Every touch gesture maps to something the desktop UI already does — nothing new to learn, just a different input.

| Gesture | Does this | Desktop equivalent |
|---|---|---|
| Tap a token | Select it | Left-click |
| Tap empty space (with a token selected) | Walk the token there, capped by its speed | Drag-to-move |
| Double-tap a token | Toggle target | Click the token's target icon |
| Tap a skill/save/spell/item on the sheet | Roll or use it | Left-click the same control on the real sheet |
| Long-press an item on the sheet | Open its action row (edit/delete/equip/...) | Right-click / the item's context menu |
| Two-finger drag on the map | Pan | Right-click-drag |
| Two-finger pinch on the map | Zoom | Mouse wheel |
| Drag the floating pan nib | Pan one-thumbed, holds direction while held | Right-click-drag (companion-only alternative when you don't have a free hand) |

## What it actually does

This module doesn't try to put the whole Foundry desktop UI on a phone screen — that doesn't work, and pretending it does makes for a worse experience than just admitting the constraint. Instead it commits to one specific, deliberately narrow shape:

- **Companion sheet** — a stripped-down actor sheet: stats, resources, skills, inventory, spells, whatever the system defines. No sidebar, no chat log, no journal clutter.
- **Tap-to-roll** — tap a skill, save, spell, or item to roll or use it, exactly the way the system's own sheet would.
- **Tap-to-move, double-tap-to-target** — the map stays live underneath the sheet; touch gestures drive token movement and targeting directly on the canvas.
- **Live, pannable map** — one-finger pan, pinch to zoom, no separate "player view" to keep in sync.
- **Installable as a PWA** — add it to the home screen, it survives reconnects, and a wake lock keeps the screen from sleeping mid-session.
- **GM-side troubleshooting** — GM-only, scoped to your own world: toggle companion mode for one of your connected players' devices if their screen gets stuck, and optionally apply a standard set of your table's own display settings the moment it activates. 

Built-in, first-class support ships for the [Vagabond](https://foundryvtt.com/packages/vagabond) system. Any other system gets a generic read-only fallback (flattened `actor.system` fields, plus raw-formula rolling) until someone adds a descriptor for it — see [Adapting a system](docs/adapting-a-system.md) below.

## Requirements

- Foundry VTT v14.

## Install

**From the package browser:** search "Play on Mobile" in Foundry's Install Module dialog.

**By manifest URL:**

```text
https://github.com/mordachai/play-on-mobile/releases/latest/download/module.json
```

Paste that into Foundry's Install Module dialog → Manifest URL field.

**Manual:** download the latest `module.zip` from the [releases page](https://github.com/mordachai/play-on-mobile/releases), unzip it into your `Data/modules/` folder, and restart Foundry.

Then enable **Play on Mobile** in your world's Manage Modules list.

## Using it

Companion mode is a per-client setting — each player (or the GM, testing) turns it on for their own device in **Configure Settings → Play on Mobile**, then reloads. It binds to whichever actor is set as that user's default character, or a specific actor a GM has bound for them.

A GM can also force it on/off remotely for a connected player's device via **Configure Settings → Play on Mobile → Player Device Control** — useful when a player's screen is stuck and they can't toggle it themselves.

## Adapting a system

The companion sheet's layout, rolls, and item interactions are driven by a per-system JSON **descriptor** — not hardcoded to Vagabond. Adding support for another system means writing a JSON file describing what to show and how to invoke that system's own rolls, with a small JavaScript escape hatch for anything JSON can't express.

See **[docs/adapting-a-system.md](docs/adapting-a-system.md)** for the full guide, or [docs/descriptor.schema.json](docs/descriptor.schema.json) for the formal schema.

## License

[MIT](LICENSE)
