// Economy: money, round rewards and the buy menu. Win pays $3250, a loss pays
// $1900 plus $500 per consecutive loss (capped at $3400), a kill pays $300 and
// a plant pays $300. The player starts at $800 with a pistol.
export const START_MONEY = 800;
export const WIN_REWARD = 3250;
export const LOSS_BASE = 1900;
export const LOSS_STREAK_BONUS = 500;
export const LOSS_MAX = 3400;
export const KILL_REWARD = 300;
export const PLANT_REWARD = 300;

export function createEconomy() {
  return { money: START_MONEY, lossStreak: 0 };
}

export function roundEnd(economy, won, kills, planted) {
  if (won) {
    economy.money += WIN_REWARD;
    economy.lossStreak = 0;
  } else {
    economy.money += Math.min(LOSS_MAX, LOSS_BASE + economy.lossStreak * LOSS_STREAK_BONUS);
    economy.lossStreak += 1;
  }
  economy.money += kills * KILL_REWARD + (planted ? PLANT_REWARD : 0);
}
