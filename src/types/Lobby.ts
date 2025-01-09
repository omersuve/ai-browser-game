import { Player } from "./Player";

export interface Lobby {
  id: number;
  session_id: number; // Foreign key to Session
  players: Player[]; // Players assigned to this lobby
  created_at: string; // ISO date string
  status: LobbyStatus; // Enum for lobby state
}

export enum LobbyStatus {
  ACTIVE = "active", // Lobby is active
  INACTIVE = "inactive", // Lobby is inactive
  COMPLETED = "completed", // Lobby has finished its gameplay
}
