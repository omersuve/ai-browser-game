import { Sacrifice } from "./Sacrifice";

export interface Round {
  id: number; // Unique round ID
  session_id: number; // Foreign key to the associated session
  round_number: number; // Sequential number of the round within the session
  start_time: string; // ISO date string representing round start time
  end_time: string; // ISO date string representing round end time
  proposal?: string; // Optional text proposal made during the round
  ai_decision?: AI_DECISION; // Decision made by AI
  sacrifices?: Sacrifice[]; // List of sacrifices made during the round
  created_at: string; // ISO date string for round creation timestamp
}

export enum AI_DECISION {
  CONTINUE = "continue",
  SHARE = "share",
  END = "end",
}
