import { Round } from "./Round";
import { Player } from "./Player";
import { GameStatus } from "./GameStatus"; // Assuming `GameStatus` is a shared type

export interface Session {
  id: number; // Unique session ID
  name: string; // Session name or title
  entry_fee: number; // Entry fee for joining the session
  max_total_players: number; // Maximum allowed players in the session
  total_rounds: number; // Total number of rounds in the session
  start_time: string; // ISO date string representing session start time
  end_time: string; // ISO date string representing session end time
  created_at: string; // ISO date string for session creation timestamp
  rounds?: Round[]; // Associated rounds (optional, for detailed responses)
  players?: Player[]; // Associated players (optional, for detailed responses)
  game_status?: GameStatus; // Derived game status (optional, for detailed responses)
}

export interface CreateSessionRequest {
  name: string; // Name of the session
  entry_fee: number; // Fee required to join the session
  total_rounds: number; // Total number of rounds in the session
  max_total_players: number; // Maximum number of players allowed in the session
  start_time: string; // Start time of the session (ISO 8601 string)
  end_time: string; // End time of the session (ISO 8601 string)
}
