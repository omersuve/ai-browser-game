export interface Player {
  id: number; // Unique player ID
  session_id: number; // Foreign key to the associated session
  wallet_address: string; // Foreign key to the User table
  joined_at: string; // ISO date string representing the join time
  eliminated_at?: string; // ISO date string for elimination (optional)
  status: "active" | "eliminated" | "winner"; // Player status in the session
  total_rounds_played: number; // Count of rounds the player has participated in
}
