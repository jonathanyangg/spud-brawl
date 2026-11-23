// Leaderboard runs: the token a score is posted with, and the over card's leaderboard line
import { boards, postScore, startRun } from '../account.js';
import { $ } from '../util.js';
import { game, player } from '../game.js';

// the leaderboard run token for this Aim Trainer or Zombies run (a promise; null inside when there's none)
let runToken = Promise.resolve(null);
export const newRun = () => { runToken = boards.on && (game === 'aim' || game === 'zombies') ? startRun(game) : Promise.resolve(null); };
// the over card's leaderboard line: where this run put you, or how to get on the board
export function boardRow(board, score, extra) {
  if (!boards.on) return;
  const tbl = $('overTbl'), tr = document.createElement('tr'), a = document.createElement('td'), b = document.createElement('td');
  a.textContent = 'Leaderboard'; tr.append(a, b); tbl.append(tr);
  if (!boards.signedIn) { b.textContent = 'Sign in to post your runs'; return; }
  b.textContent = 'Posting…';
  const run = runToken; runToken = Promise.resolve(null); // a token is good for one score
  run.then(t => postScore(board, score, extra, player.name, t)).then(r => {
    b.textContent = !r ? 'Could not post this run' : r.newBest ? `New best, #${r.rank}` : `Your best is #${r.rank}`;
  });
}
