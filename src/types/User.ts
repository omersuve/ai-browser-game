export interface User {
  wallet_address: string; // Primary key (unique identifier for the user)
  total_winnings: number; // Total winnings in tokens
  total_profits: number; // Total net profit (winnings - entry fees)
  created_at: string; // ISO date string for user creation timestamp
}
