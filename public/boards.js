// The leaderboards (shared by the game and the server, which checks scores against these limits)
// Limits, from the game's pacing (public/game.js):
// - Aim Trainer: 60 s, 3 targets, a hit one moves at once to a random spot up to ~52 degrees off your aim. The SMG could
//   fire ~430 shots in that time, so the gun isn't the limit; finding and flicking onto each target is. 240 hits is
//   4 a second for the whole minute, already past what the best players manage, with a little headroom.
// - Zombies: wave n is 4 + 3n zombies (x1.5 per extra player, 12 at most), spawned one at a time at least
//   max(0.35, 1.5 - 0.08n) s apart, then a 6 s break before the next. Zombies have 50 + 12n health, so by wave 60 each
//   takes ~60 SMG hits and there are 180+ of them; wave 100 is far past any real run. Kills can't pass every zombie
//   spawned up to the wave you reached, with a full room.
// minMs: the least time a run that scored n can have taken. A wave can't be cleared before all its zombies have
// spawned and the break before the next is over: 6 s + (3 + 3n) x that gap, at least 14.5 s (wave 1). 12 s a wave
// leaves room for clocks and the network. ttl: how long a run's token lasts (a run can be paused).
const ZOMBIES_UPTO = w => Math.round(6.5 * (4 * w + 1.5 * w * (w + 1))); // sum of 4 + 3k for k = 1..w, with 12 players
export const BOARDS = {
  aim: { name: 'Aim Trainer', max: 240, extraMax: 100, minMs: () => 55000, ttl: 30 * 60000, score: n => `${n} hits`, extra: n => `${n}% accuracy` },
  zombies: { name: 'Zombies', max: 100, extraMax: ZOMBIES_UPTO(100), extraFor: ZOMBIES_UPTO, minMs: n => Math.max(0, n - 1) * 12000, ttl: 12 * 3600000,
    score: n => `Wave ${n}`, extra: n => `${n} kills` },
};
export const BOARD_TOP = 20;
// a run the leaderboard can take: a known board, whole numbers inside its limits
export function scoreCheck(board, score, extra) {
  const b = Object.hasOwn(BOARDS, board) ? BOARDS[board] : null;
  if (!b) return 'Unknown leaderboard';
  if (!Number.isInteger(score) || score < 0 || score > b.max || !Number.isInteger(extra) || extra < 0 || extra > (b.extraFor ? b.extraFor(score) : b.extraMax)) return 'That score is not possible';
  return null;
}
// callsigns as the game cleans them: no control or invisible formatting characters, 16 at most
export const boardName = v => String(v || '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g, '').trim().slice(0, 16) || 'Soldier';
