// The leaderboards (shared by the game and the server, which checks scores against these limits)
export const BOARDS = {
  aim: { name: 'Aim Trainer', max: 400, extraMax: 100, score: n => `${n} hits`, extra: n => `${n}% accuracy` },
  zombies: { name: 'Zombies', max: 500, extraMax: 100000, score: n => `Wave ${n}`, extra: n => `${n} kills` },
};
export const BOARD_TOP = 20;
// a run the leaderboard can take: a known board, whole numbers inside its limits
export function scoreCheck(board, score, extra) {
  const b = Object.hasOwn(BOARDS, board) ? BOARDS[board] : null;
  if (!b) return 'Unknown leaderboard';
  if (!Number.isInteger(score) || score < 0 || score > b.max || !Number.isInteger(extra) || extra < 0 || extra > b.extraMax) return 'That score is not possible';
  return null;
}
// callsigns as the game cleans them: no control or invisible formatting characters, 16 at most
export const boardName = v => String(v || '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g, '').trim().slice(0, 16) || 'Soldier';
