// Economy: money, round rewards and the buy menu. The numbers are the
// Counter-Strike-style spine of the game, kept in one place so a balance
// change is a one-line edit and never a hunt through the rules:
//
//   win            $3,250, and the loss streak resets
//   loss           $1,900 plus $500 per consecutive loss, capped at $3,400
//   kill           $300
//   plant          $300
//
// The player starts at $800 with a pistol. A rifle costs $2,700, so a win
// (or two losses) buys one — the first rounds are pistol rounds on purpose.
export const START_MONEY = 800;
export const WIN_REWARD = 3250;
export const LOSS_BASE = 1900;
export const LOSS_STREAK_BONUS = 500;
export const LOSS_MAX = 3400;
export const KILL_REWARD = 300;
export const PLANT_REWARD = 300;

// The loss reward for a team on a streak of `lossStreak` consecutive losses.
// The cap keeps a long losing run from printing money: at 3 losses the
// payout is already at the $3,400 ceiling.
export function lossReward(lossStreak) {
  return Math.min(LOSS_MAX, LOSS_BASE + lossStreak * LOSS_STREAK_BONUS);
}

export function createEconomy() {
  return { money: START_MONEY, lossStreak: 0 };
}

// Settle a round: the round reward (win or loss) plus the per-kill and
// plant bonuses. The win resets the loss streak; a loss extends it, so the
// next loss pays more. Returns the amount earned, so the HUD can show it.
export function roundEnd(economy, won, kills, planted) {
  const before = economy.money;
  if (won) {
    economy.money += WIN_REWARD;
    economy.lossStreak = 0;
  } else {
    economy.money += lossReward(economy.lossStreak);
    economy.lossStreak += 1;
  }
  economy.money += kills * KILL_REWARD + (planted ? PLANT_REWARD : 0);
  return economy.money - before;
}

// "$2,700" — the HUD's money format, here so every readout agrees.
export function formatMoney(amount) {
  return `$${amount.toLocaleString('en-US')}`;
}

// True when the player can pay `price` right now. The buy menu uses this
// for the denied sound, so a broke player gets feedback instead of silence.
export function canAfford(economy, price) {
  return economy.money >= price;
}
