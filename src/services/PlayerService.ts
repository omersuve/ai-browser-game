import { Pool } from "pg";
import { RedisService } from "../redis/RedisService";
import { Lobby, LobbyStatus, Player, PLAYER_STATUS } from "../types";
import Pusher from "pusher";

export default class PlayerService {
  private db: Pool;
  private redis: RedisService;
  private pusher: Pusher;

  constructor(db: Pool, redis: RedisService, pusher: Pusher) {
    this.db = db;
    this.redis = redis;
    this.pusher = pusher;
  }

  /**
   * Fetches all players for a session.
   * @param sessionId - The session ID.
   * @returns An array of players.
   */
  async getPlayers(sessionId: number): Promise<Player[]> {
    const key = `session:${sessionId}:players`;

    // Try to fetch players from Redis
    const cachedPlayers = await this.redis.smembers(key);

    if (cachedPlayers.length > 0) {
      // Return cached players
      return cachedPlayers.map((walletAddress) => ({
        id: 0, // Default placeholder (use `null` or optional if your type allows it)
        wallet_address: walletAddress,
        session_id: sessionId,
        joined_at: "", // Default placeholder (adjust based on your use case)
        total_rounds_played: 0, // Default placeholder
        status: "active",
      })) as Player[]; // Ensure the type matches
    }

    // Fallback to PostgreSQL if not in Redis
    const result = await this.db.query(
      `SELECT wallet_address, session_id, status
       FROM players
       WHERE session_id = $1`,
      [sessionId]
    );

    const players = result.rows as Player[];

    // Cache players in Redis if any are found
    if (players.length > 0) {
      await this.redis.sadd(
        key,
        players.map((player) => player.wallet_address)
      );
    } else {
      console.warn(`No players found for session ${sessionId}.`);
    }

    return players;
  }

  /**
   * Updates the status of a player in Redis.
   * @param lobbyId - The lobby ID.
   * @param walletAddress - The wallet address of the player.
   * @param status - The new status of the player.
   */
  async updatePlayerStatus(
    lobbyId: number,
    walletAddress: string,
    status: PLAYER_STATUS
  ): Promise<void> {
    const playerKey = `lobby:${lobbyId}:player:${walletAddress}`;
    const playerData: { status: PLAYER_STATUS } = await this.redis.get(
      playerKey
    );

    if (!playerData) {
      throw new Error(
        `Player with wallet address ${walletAddress} not found in lobby ${lobbyId}.`
      );
    }

    const updatedPlayerData = {
      status,
    };

    // Update the player's status in Redis
    await this.redis.set(playerKey, JSON.stringify(updatedPlayerData));
    console.log(
      `Updated status for player ${walletAddress} in lobby ${lobbyId} to ${status}.`
    );
  }

  /**
   * Randomly distributes players into lobbies.
   * @param sessionId - The session ID.
   * @param maxPlayersPerLobby - The maximum number of players per lobby.
   * @returns An array of lobby assignments.
   */
  async distributePlayersToLobbies(
    sessionId: number,
    maxPlayersPerLobby: number
  ): Promise<{ lobbyId: number; players: Player[] }[]> {
    // Fetch all players
    const players = await this.getPlayers(sessionId);

    if (players.length === 0) {
      console.warn(`No players to distribute for session ${sessionId}.`);
      return [];
    }

    // Shuffle the players
    const shuffledPlayers = players.sort(() => Math.random() - 0.5);

    // Calculate number of lobbies needed
    const totalPlayers = shuffledPlayers.length;

    // If total players is less than or equal to maxPlayersPerLobby, create just one lobby
    let numLobbies = Math.floor(totalPlayers / maxPlayersPerLobby);
    if (numLobbies === 0 || totalPlayers % maxPlayersPerLobby !== 0) {
      numLobbies = Math.max(1, numLobbies);
    }

    // Calculate minimum players per lobby to ensure even distribution
    const minPlayersPerLobby = Math.floor(totalPlayers / numLobbies);
    const extraPlayers = totalPlayers - minPlayersPerLobby * numLobbies;

    // Divide players into lobbies
    const lobbies = [];
    let lobbyId = 1;
    let playerIndex = 0;

    for (let i = 0; i < numLobbies; i++) {
      const lobbyKey = `lobby:session:${sessionId}:lobby:${lobbyId}`;

      // Add extra players to the last lobby
      const playersInThisLobby =
        i === numLobbies - 1
          ? minPlayersPerLobby + extraPlayers
          : minPlayersPerLobby;

      const lobbyPlayers = shuffledPlayers.slice(
        playerIndex,
        playerIndex + playersInThisLobby
      );
      playerIndex += playersInThisLobby;

      // Set each player's status as ACTIVE in Redis
      for (const player of lobbyPlayers) {
        const playerKey = `lobby:${lobbyId}:player:${player.wallet_address}`;
        await this.redis.set(
          playerKey,
          JSON.stringify({
            status: PLAYER_STATUS.ACTIVE,
          })
        );
        console.log(`Set player status to ACTIVE in Redis: ${playerKey}`);
      }

      // Create a Lobby object
      const lobby: Lobby = {
        id: lobbyId,
        session_id: sessionId,
        players: lobbyPlayers,
        created_at: new Date().toISOString(),
        status: LobbyStatus.ACTIVE,
      };

      // Store lobby data in Redis
      await this.redis.set(lobbyKey, JSON.stringify(lobby));
      console.log(`Stored lobby in Redis: ${lobbyKey}`);

      // Create a lobby entry
      lobbies.push({ lobbyId, players: lobbyPlayers });

      // Add the lobby key to the session lobbies set
      const sessionLobbiesKey = `lobby:session:${sessionId}:lobbies`;
      await this.redis.sadd(sessionLobbiesKey, [lobbyKey]);

      // Notify via Pusher
      await this.pusher.trigger("lobby", "lobby-created", {
        sessionId,
        lobbyId,
        players: lobbyPlayers,
      });

      lobbyId++;
    }

    return lobbies;
  }
}
