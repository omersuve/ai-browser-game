import { AI_DECISION } from "./Round";

export interface GameStatus {
  ended_early: boolean; // Indicates whether the session ended early
  ended_at_round?: number; // The round number where the session ended (optional)
  decision?: AI_DECISION; // Decision that concluded the session
}
