# Spud Brawl

Arena shooter in the browser (three.js). Play vs bots, or online with friends in a shared room.

**Games:** Free-for-all, Zombies (co-op waves, solo or online), Gun Game, Moon Knives (knives only, low gravity), Snipers Only (one body shot kills), and a solo Aim Trainer.

**Maps:**
- **Highrise:** a three-storey block (stairwells zigzag up to a roof, with a balcony on the 2nd floor) joined by a skybridge to an annex with a roof terrace.
- **Depot:** containers, a gutted office, sniper decks.
- **Market Yard:** the original.
- **Dunes:** a desert outpost whose raised plaza has tunnels crossing underneath, plus a hut you can climb onto.
- **Frostbite:** a snowed-in radio outpost with a two-storey lodge.
- **Stackyard:** a tiny square of containers with catwalks across the tops, for fast fights on two levels.

Bots and zombies use the stairs (each map lists its flights, with doorway points for indoor ones), and zombies climb walls to reach anyone above them.

```
npm install
npm start        # http://localhost:3000
npm test         # progression logic + relay self-check
```

## Layout

- `server.js`: serves `public/` and relays player state between everyone in a room over a WebSocket at `/ws`. No game logic lives on the server.
- `public/game.js`: the game (rendering, physics, bots, HUD, online sync)
- `public/net.js`: WebSocket client, auto-reconnects
- `public/world.js`: maps (every solid thing is a box), textures, spawn points
- `public/config.js`: weapons, movement speeds, bot skill, default key bindings
- `public/audio.js`: generated sound effects
- `public/music.js`: generated soundtrack (a menu theme and a match theme, Web Audio, no files)
- `public/progress.js`: XP, levels, unlock rules and attachment stats (pure logic, tested by `npm test`)
- `public/skins.js`: camo patterns drawn on a canvas, used on soldiers, guns and Armory swatches
- `public/armory.js`: the Armory screen

## Controls

WASD move, Shift sprint, C crouch, Space jump, right-click aim down sights, 1/2/3 or wheel to switch weapon, G throw equipment, R reload. All rebindable under Controls.

**Settings** (sensitivity, aiming sensitivity, field of view, volume, music) and your **Loadout** open from the pause screen too, so you never have to leave a match. Weapon changes made mid-match apply when you next respawn.

## Weapons

Six weapons; you carry three: SMG, Shotgun, Sniper, AR, RPG (unlocks at level 6, splash damage, rocket-jumps hurt) and Knife (faster movement). One throwable: Frag, Stun (slows movement and aim; level 3) or Flashbang (whites out anyone looking at it; level 5).

**Slide:** press crouch while sprinting. **Slide cancel:** press crouch again (or jump) mid-slide to pop straight back into a sprint with the slide's speed. Chain them to move faster than a plain sprint.

## Progression

Every kill earns XP (more for headshots, frags and streaks), and every finished match adds a bonus, bigger for a win. There are 55 levels.

- **Uniforms** unlock as you level up and dress your soldier's legs and arms (other players see them online).
- **Camos** unlock per weapon from kills and headshots with it: Woodland, Desert, Urban, Tiger, Crimson, Gold (the RPG skips the headshot goals). Get Gold on any three weapons for Nebula.
- **Attachments** unlock by level; equip up to two per gun: Extended mag (+50% mag, slower reload), Laser sight (tighter hip fire), Suppressor (quiet shots, no muzzle flash, less range), Fast mag (30% faster reload).

Pick them in the **Armory** from the main menu. The menu shows your level, XP bar and how many unlocks you haven't looked at yet.

Progress is saved in this browser's localStorage (key `spudbrawl-progress`). There are no accounts: a different browser or device starts from level 1, and clearing site data resets it.

Music can be turned off in the menu; **M** mutes everything.

## Online play

Pick **Online with friends**, type a room code, press **Join room**. **Copy invite link** gives a URL that drops friends into the same room. Up to 12 players per room. Whoever opens a room picks its game and map; everyone who joins plays those.

Each client owns its own health: shooters report hits, and the player who was hit applies the damage and announces their own death. That's fine for friends, but it trusts the clients.

In Zombies, one player runs the zombies for the room (the lowest player id still in the match) and streams them with their presence; everyone else sends their hits on zombies to that player. If they leave, the next player picks the zombies up where they are.

## Deploy

Any host that runs a long-lived Node process with WebSockets works (Render, Railway, Fly). Build: `npm install`, start: `npm start`. It listens on `$PORT`.
