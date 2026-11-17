# Spud Brawl

Free-for-all potato shooter in the browser (three.js). Play vs bots, or online with friends in a shared room.

```
npm install
npm start        # http://localhost:3000
npm test         # relay self-check
```

## Layout

- `server.js`: serves `public/` and relays player state between everyone in a room over a WebSocket at `/ws`. No game logic lives on the server.
- `public/game.js`: the game (rendering, physics, bots, HUD, online sync)
- `public/net.js`: WebSocket client, auto-reconnects
- `public/config.js`: weapons, bot skill, default key bindings
- `public/audio.js`: generated sound effects

## Online play

Pick **Online with friends**, type a room code, press **Join room**. **Copy invite link** gives a URL that drops friends into the same room. Up to 12 players per room.

Each client owns its own health: shooters report hits, and the player who was hit applies the damage and announces their own death. That's fine for friends, but it trusts the clients.

## Deploy

Any host that runs a long-lived Node process with WebSockets works (Render, Railway, Fly). Build: `npm install`, start: `npm start`. It listens on `$PORT`.
