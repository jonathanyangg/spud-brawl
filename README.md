# Spud Brawl

Free-for-all arena shooter in the browser (three.js). Play vs bots, or online with friends in a shared room.

Two maps: **Depot** (shipping containers, a gutted office, sniper decks, loading docks) and **Market Yard**.

```
npm install
npm start        # http://localhost:3000
npm test         # relay self-check
```

## Layout

- `server.js`: serves `public/` and relays player state between everyone in a room over a WebSocket at `/ws`. No game logic lives on the server.
- `public/game.js`: the game (rendering, physics, bots, HUD, online sync)
- `public/net.js`: WebSocket client, auto-reconnects
- `public/world.js`: maps (every solid thing is a box), textures, spawn points
- `public/config.js`: weapons, movement speeds, bot skill, default key bindings
- `public/audio.js`: generated sound effects

## Controls

WASD move, Shift sprint, C crouch, Space jump, right-click aim down sights, 1/2/3 or wheel for SMG/Shotgun/Sniper, G frag, R reload. All rebindable under Controls.

**Slide:** press crouch while sprinting. **Slide cancel:** press crouch again (or jump) mid-slide to pop straight back into a sprint with the slide's speed. Chain them to move faster than a plain sprint.

## Online play

Pick **Online with friends**, type a room code, press **Join room**. **Copy invite link** gives a URL that drops friends into the same room. Up to 12 players per room. Whoever opens a room picks its map; everyone who joins plays that map.

Each client owns its own health: shooters report hits, and the player who was hit applies the damage and announces their own death. That's fine for friends, but it trusts the clients.

## Deploy

Any host that runs a long-lived Node process with WebSockets works (Render, Railway, Fly). Build: `npm install`, start: `npm start`. It listens on `$PORT`.
