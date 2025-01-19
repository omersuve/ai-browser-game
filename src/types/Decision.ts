export interface AIResponse {
  response: any[];
  success: boolean; // Wallet addresses of eliminated players
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
