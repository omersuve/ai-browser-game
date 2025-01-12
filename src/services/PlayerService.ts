import { Pool } from "pg";
import { RedisService } from "../redis/RedisService";
import { Player } from "../types";
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
   * Adds a player to a session.
   * @param sessionId - The session ID.
   * @param walletAddress - The wallet address of the player.
   */
  async addPlayer(sessionId: number, walletAddress: string): Promise<void> {
    // Check if the player already exists in Redis or DB
    const key = `session:${sessionId}:players`;
    const existsInRedis = await this.redis.sismember(key, walletAddress);

    if (existsInRedis) {
      throw new Error(
        `Player ${walletAddress} already joined session ${sessionId}`
      );
    }

    // Add the player to PostgreSQL
    await this.db.query(
      `INSERT INTO players (session_id, wallet_address, joined_at)
       VALUES ($1, $2, (NOW() AT TIME ZONE 'UTC'))`,
      [sessionId, walletAddress]
    );

    // Cache the player in Redis
    await this.redis.sadd(key, [walletAddress]);

    // Notify via Pusher
    await this.pusher.trigger(`session-${sessionId}`, "player-joined", {
      walletAddress,
    });
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

    // Shuffle the players
    const shuffledPlayers = players.sort(() => Math.random() - 0.5);

    // Divide players into lobbies
    const lobbies = [];
    let lobbyId = 1;

    for (let i = 0; i < shuffledPlayers.length; i += maxPlayersPerLobby) {
      const lobbyPlayers = shuffledPlayers.slice(i, i + maxPlayersPerLobby);

      // Create a lobby entry
      lobbies.push({
        lobbyId: lobbyId++,
        players: lobbyPlayers,
      });

      // Store lobby data in Redis
      const lobbyKey = `lobby:session:${sessionId}:lobby:${lobbyId}`;
      await this.redis.set(lobbyKey, JSON.stringify(lobbyPlayers));

      // Notify via Pusher
      await this.pusher.trigger(`lobby-${lobbyId}`, "lobby-updated", {
        lobbyId,
        players: lobbyPlayers,
      });
    }

    return lobbies;
  }
}
