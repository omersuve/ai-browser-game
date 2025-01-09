export interface AIResponse {
  announcement: string;
  eliminatedPlayers?: string[]; // Wallet addresses of eliminated players
}

export interface LobbyData {
  lobby_id: number;
  forum_messages: {
    wallet_address: string;
    content: string;
    timestamp: string;
  }[];
  remaining_players: string[];
}

export interface RoundDecision {
  sessionId: number;
  lobbies: LobbyData[];
}
