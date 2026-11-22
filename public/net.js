// Connection to the relay server (server.js). Each player sends one "presence" object
// (position, aim, score, recent events); the server forwards it to everyone else in the room.
// Reconnects on its own if the link drops.
// opts: what a new room is set up with ({ map, game, bots, diff, ts, lim, side, pub }); joining an existing room ignores them
// id is public (everyone in the room sees it); key is secret and only goes to the server, which needs it to give a seat back
export function joinRoom(code, id, key, opts, { onPeer, onLeave, onStatus, onRoom, onHost }) {
  let ws = null, mine = null, dead = false, retryT = null, tries = 0;
  const q = new URLSearchParams({ room: code, id, key, ...opts });
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?${q}`;

  function connect() {
    if (dead) return;
    onStatus('connecting');
    ws = new WebSocket(url);
    ws.onopen = () => { tries = 0; onStatus('ready'); send(); };
    ws.onmessage = ({ data }) => {
      if (dead) return;
      let m; try { m = JSON.parse(data); } catch (e) { return; }
      if (m.t === 'p' && m.pr && typeof m.pr === 'object') onPeer(m.k, m.pr, m.tm);
      else if (m.t === 'bye') onLeave(m.k);
      else if (m.t === 'room') onRoom(m); // what the room is playing: map, game, cfg, my team, and who the host is
      else if (m.t === 'host') onHost(m.k);
      else if (m.t === 'full' || m.t === 'busy' || m.t === 'taken') { dead = true; onStatus(m.t); } // busy: a battle royale is under way; taken: our id, someone else's key
    };
    ws.onclose = () => {
      if (dead) return;
      onLeave(null); // everyone; they come back from the server's snapshot on reconnect
      onStatus('connecting');
      clearTimeout(retryT); retryT = setTimeout(connect, Math.min(5000, 500 * 2 ** tries++));
    };
  }
  function send() {
    // skip a frame if the socket is backed up; the event ring in the presence carries anything missed
    if (mine && ws && ws.readyState === 1 && ws.bufferedAmount < 64000) ws.send(mine);
  }
  connect();
  return {
    presence(pr) { mine = JSON.stringify(pr); send(); },
    // a one-off message for the server itself (the leader's room settings, handing over the lead)
    control(msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); },
    leave() { dead = true; clearTimeout(retryT); if (ws) ws.close(); },
  };
}
