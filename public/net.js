// Connection to the relay server (server.js). Each player sends one "presence" object
// (position, aim, score, recent events); the server forwards it to everyone else in the room.
// Reconnects on its own if the link drops.
export function joinRoom(code, id, { onPeer, onLeave, onStatus }) {
  let ws = null, mine = null, dead = false, retryT = null, tries = 0;
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?room=${encodeURIComponent(code)}&id=${id}`;

  function connect() {
    if (dead) return;
    onStatus('connecting');
    ws = new WebSocket(url);
    ws.onopen = () => { tries = 0; onStatus('ready'); send(); };
    ws.onmessage = ({ data }) => {
      if (dead) return;
      let m; try { m = JSON.parse(data); } catch (e) { return; }
      if (m.t === 'p' && m.pr && typeof m.pr === 'object') onPeer(m.k, m.pr);
      else if (m.t === 'bye') onLeave(m.k);
      else if (m.t === 'full') { dead = true; onStatus('full'); }
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
    leave() { dead = true; clearTimeout(retryT); if (ws) ws.close(); },
  };
}
