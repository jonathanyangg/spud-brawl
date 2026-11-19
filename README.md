# Spud Brawl

Arena shooter in the browser (three.js). Play vs bots offline, or online: browse public games or create a room
(public, or private and joined by code or invite link). Online rooms can have bots too.

**Games:**
- **Free-for-all:** first to 20.
- **Team Deathmatch:** Blue against Red, 1v1 up to 5v5, first team to 15, 25 or 50. Bots fill the empty seats.
  Online, the room's creator picks whether players go on one team against bots, or get split evenly.
- **Battle Royale:** one life, a storm that closes in over five phases (more damage each phase), and a kill heals
  you 50 and refills your guns. Last one standing wins.
- **Zombies** (co-op waves), **Gun Game**, **Moon Knives** (knives only, low gravity), **Snipers Only** (one body shot
  kills), and a solo **Aim Trainer**.

**Maps:** each one has its own file in `public/maps/`. All have several levels, tunnels or covered passages, and jump
pads (step on the glowing pad and it throws you up onto a ledge or roof).
- **Depot:** a rail yard with container stacks and catwalks, a station platform with a tunnel inside, a train you can
  run through and across, a gantry crane, a signal box, a three-storey office and a warehouse.
- **Old Town:** a fountain square between two tall houses, a bell tower, a town wall with gatehouses, a garden terrace
  over a vaulted tunnel, row houses, an inn, and a covered market.
- **Dunes:** desert canyons split by rock ridges, with ruins, tunnels through the ridges and a walkable ridge top.
- **Frostbite:** a slippery frozen lake (you slide on ice), a snow hill with tunnels and an ice cave, a research station,
  log cabins with lofts, a frozen waterfall and a ski lift.
- **Stackyard:** a small container yard: stacks two and three high, containers you run through, catwalks, a crane.
- **Highrise:** a city block: a parking garage, walk-ups with fire escapes, a plaza over an underpass, an elevated
  train line and an office tower.

Bots and zombies find their way round walls on a ground grid (`public/nav.js`), change floors by the stairs and
jump pads, and zombies climb walls to reach anyone above them.

**Online netcode:** the server only relays. Each player owns their own health. The room's host (whoever has been
in it longest) runs the bots and the battle royale storm, and puts them in its updates; if the host leaves, the next
player takes the bots over where they were.

```
npm install
npm start        # http://localhost:3000
npm test         # progression + economy logic, pathfinding, relay, /api, headless browser
node tools/mapcheck.mjs   # every map: spawns, stairs, jump pads, connected ground
```

`npm test` runs the game in headless Chromium if Playwright is installed (skipped otherwise). three.js comes from
cdnjs; where that host is blocked, point `THREE_JS` at a local r128 `three.min.js`.

## Layout

- `server.js`: serves `public/` and relays player state between everyone in a room over a WebSocket at `/ws`. No game logic lives on the server.
- `api.js`: accounts, coins, daily spin, shop, Stripe Checkout and webhook, cloud save (`/api/...`; off until configured, see [SETUP.md](SETUP.md))
- `supabase/schema.sql`: the database (profiles, purchases, row level security, atomic spin/buy/credit functions)
- `public/game.js`: the game (rendering, physics, bots, HUD, online sync)
- `public/net.js`: WebSocket client, auto-reconnects
- `public/world.js`: the list of maps and loading one
- `public/kit.js`: the map-building kit: boxes, walls, floors, stairs, jump pads, textures
- `public/maps/*.js`: one file per map
- `public/nav.js`: the ground grid bots and zombies path on
- `tools/mapcheck.mjs`: builds maps in Node and checks spawns, stairs, pads and that the ground is all connected (`node tools/mapcheck.mjs [map] --png` also draws a top-down picture)
- `public/config.js`: weapons, movement speeds, bot skill, default key bindings
- `public/audio.js`: generated sound effects
- `public/music.js`: generated soundtrack (a menu theme and a match theme, Web Audio, no files)
- `public/progress.js`: XP, levels, unlock rules and attachment stats (pure logic, tested by `npm test`)
- `public/skins.js`: camo patterns drawn on a canvas, used on soldiers, guns and Armory swatches
- `public/armory.js`: the Armory screen (and the coin shop's looks when signed in)
- `public/economy.js`: spin table, cooldown, coin packs, buy rules (pure logic, shared by server and client, tested)
- `public/account.js`: sign-in panel, coin balance, spin wheel, coin packs, cloud sync

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

Progress is saved in this browser's localStorage (key `spudbrawl-progress`). Without an account, a different browser or device starts from level 1, and clearing site data resets it.

## Accounts, coins and the shop

Off by default; [SETUP.md](SETUP.md) lists the steps and env vars that switch them on. Once on:

- **Sign in** from the menu with your email (a magic link, no password). Your progress syncs to the cloud: on sign-in the save with more XP wins on both sides.
- **Coins** buy named, coin-only looks in the Armory: Hazard and Toxic uniforms, Cherry, Carbon and Glacier camos (a bought camo fits every weapon). Friends see them online.
- **Daily spin**: one free spin every 24 hours for coins or a spin-only look (Golden Spud uniform, Lucky camo). Spins are never sold, and the odds are shown on the wheel.
- **Get coins**: three coin packs through Stripe Checkout.

The server decides everything that touches coins: it checks your Supabase token on every call, picks spin prizes and prices, and writes through atomic Postgres functions. Coin packs are credited only by Stripe's signed webhook, once per payment.

Music can be turned off in the menu; **M** mutes everything.

## Online play

Pick **Online with friends**, type a room code, press **Join room**. **Copy invite link** gives a URL that drops friends into the same room. Up to 12 players per room. Whoever opens a room picks its game and map; everyone who joins plays those.

Each client owns its own health: shooters report hits, and the player who was hit applies the damage and announces their own death. That's fine for friends, but it trusts the clients.

In Zombies, one player runs the zombies for the room (the lowest player id still in the match) and streams them with their presence; everyone else sends their hits on zombies to that player. If they leave, the next player picks the zombies up where they are.

## Deploy

Any host that runs a long-lived Node process with WebSockets works (Render, Railway, Fly). Build: `npm install`, start: `npm start`. It listens on `$PORT`. Accounts and payments read `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and optionally `SITE_URL` (see [SETUP.md](SETUP.md)).
