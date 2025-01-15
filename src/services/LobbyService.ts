import { RedisService } from "../redis/RedisService";
import Pusher from "pusher";
import { Player, Lobby, LobbyStatus } from "../types";

export default class LobbyService {
  private redisService: RedisService;
  private pusher: Pusher;
  private lobbyKeyPrefix = "lobby"; // Key prefix for lobbies

  constructor(redisService: RedisService, pusher: Pusher) {
    this.redisService = redisService;
    this.pusher = pusher;
  }

  /**
   * Creates a lobby for a session.
   * @param sessionId - The session ID.
   * @param lobbyId - The unique ID for the lobby.
   */
  async createLobby(
    sessionId: number,
    lobbyId: number,
    players: Player[]
  ): Promise<void> {
    const lobbyKey = this.getLobbyKey(sessionId, lobbyId);
    const sessionLobbiesKey = `${this.lobbyKeyPrefix}:session:${sessionId}:lobbies`;

    const exists = await this.redisService.exists(lobbyKey);
    if (exists) {
      console.warn(`Lobby already exists for ${lobbyKey}`);
      return;
    }

    const lobby: Lobby = {
      id: lobbyId,
      session_id: sessionId,
      players,
      created_at: new Date().toISOString(), // Convert to ISO string
      status: LobbyStatus.ACTIVE,
    };

    // Store the lobby data in Redis
    try {
      await this.redisService.set(lobbyKey, JSON.stringify(lobby));
      await this.redisService.sadd(sessionLobbiesKey, [lobbyKey]);
      console.log(`Created lobby: ${lobbyKey}`);
    } catch (error: any) {
      console.error(`Failed to store lobby for key: ${lobbyKey}`, error);
      // Cleanup on failure
      await this.redisService.del(lobbyKey);
      throw new Error(`Failed to create lobby: ${error.message}`);
    }

    console.log(`Created lobby: ${lobbyKey}`);
  }

  /**
   * Adds a player to a lobby.
   * @param sessionId - The session ID.
   * @param lobbyId - The lobby ID.
   * @param player - The player to add.
   * @param maxPlayers - The max number of players allowed.
   */
  async addPlayerToLobby(
    sessionId: number,
    lobbyId: number,
    player: Player,
    maxPlayers: number
  ): Promise<void> {
    const lobbyKey = this.getLobbyKey(sessionId, lobbyId);
    const lobbyData = await this.redisService.get(lobbyKey);

    if (!lobbyData) {
      throw new Error(`Lobby does not exist for ${lobbyKey}`);
    }

    const lobby: Lobby = JSON.parse(lobbyData);
    if (lobby.players.length >= maxPlayers) {
      throw new Error(`Lobby ${lobbyId} is already full`);
    }

    lobby.players.push(player);

    await this.redisService.set(lobbyKey, JSON.stringify(lobby));
    console.log(`Added player ${player.wallet_address} to lobby: ${lobbyKey}`);
  }

  /**
   * Removes a player from a lobby.
   * @param sessionId - The session ID.
   * @param lobbyId - The lobby ID.
   * @param walletAddress - The player's wallet address to remove.
   */
  async removePlayerFromLobby(
    sessionId: number,
    lobbyId: number,
    walletAddress: string
  ): Promise<void> {
    const lobbyKey = this.getLobbyKey(sessionId, lobbyId);
    const lobbyData = await this.redisService.get(lobbyKey);

    if (!lobbyData) {
      throw new Error(`Lobby does not exist for ${lobbyKey}`);
    }

    const lobby: Lobby = JSON.parse(lobbyData);
    lobby.players = lobby.players.filter(
      (player) => player.wallet_address !== walletAddress
    );

    await this.redisService.set(lobbyKey, JSON.stringify(lobby));
    console.log(`Removed player ${walletAddress} from lobby: ${lobbyKey}`);
  }

  /**
   * Retrieves lobby data.
   * @param sessionId - The session ID.
   * @param lobbyId - The lobby ID.
   * @returns The lobby data.
   */
  async getLobby(sessionId: number, lobbyId: number): Promise<Lobby | null> {
    const lobbyKey = this.getLobbyKey(sessionId, lobbyId);
    const lobbyData = await this.redisService.get(lobbyKey);

    if (!lobbyData) {
      return null;
    }

    return JSON.parse(lobbyData) as Lobby;
  }

  /**
   * Retrieves all lobbies for a given session.
   * @param sessionId - The session ID.
   * @returns An array of lobbies.
   */
  async getAllLobbies(sessionId: number): Promise<Lobby[]> {
    const sessionLobbiesKey = `${this.lobbyKeyPrefix}:session:${sessionId}:lobbies`;

    // Fetch all lobby keys for the session
    const lobbyKeys = await this.redisService.smembers(sessionLobbiesKey);

    console.log("lobbyKeys:", lobbyKeys);

    if (lobbyKeys.length === 0) {
      console.warn(`No lobbies found for session ${sessionId}.`);
      return []; // Return an empty array if no lobbies exist
    }

    const lobbies: Lobby[] = [];
    for (const key of lobbyKeys) {
      const lobbyData: Lobby = await this.redisService.get(key);
      console.log("lobbyData:", lobbyData);
      console.log("type of lobbyData:", typeof lobbyData);
      if (lobbyData) {
        try {
          lobbies.push(lobbyData);
        } catch (error) {
          console.error(`Invalid lobby data for key ${key}:`, error);
        }
      } else {
        console.warn(`No data found for lobby key ${key}`);
      }
    }

    console.log(
      `Retrieved ${lobbies.length} lobbies for session ${sessionId}.`
    );
    return lobbies;
  }

  /**
   * Deletes a lobby.
   * @param sessionId - The session ID.
   * @param lobbyId - The lobby ID.
   */
  async deleteLobby(sessionId: number, lobbyId: number): Promise<void> {
    const lobbyKey = this.getLobbyKey(sessionId, lobbyId);
    await this.redisService.del(lobbyKey);
    console.log(`Deleted lobby: ${lobbyKey}`);
  }

  /**
   * Updates a lobby's details.
   * @param sessionId - The session ID.
   * @param lobbyId - The lobby ID.
   * @param updatedData - Partial data to update the lobby.
   */
  async updateLobby(
    sessionId: number,
    lobbyId: number,
    updatedData: Partial<Lobby>
  ): Promise<void> {
    const lobbyKey = this.getLobbyKey(sessionId, lobbyId);
    const lobbyData = await this.redisService.get(lobbyKey);

    if (!lobbyData) {
      throw new Error(`Lobby does not exist for ${lobbyKey}`);
    }

    // Parse existing lobby and merge with updated data
    const existingLobby = JSON.parse(lobbyData) as Lobby;
    const updatedLobby = { ...existingLobby, ...updatedData };

    // Save the updated lobby back to Redis
    await this.redisService.set(lobbyKey, JSON.stringify(updatedLobby));

    console.log(`Updated lobby ${lobbyId} for session ${sessionId}`);
  }

  /**
   * Publishes a real-time lobby update via Pusher.
   * @param sessionId - The session ID.
   * @param lobbyId - The lobby ID.
   * @param message - The update message.
   */
  async publishLobbyUpdate(
    sessionId: number,
    lobbyId: number,
    message: string
  ): Promise<void> {
    const channel = `lobby-${sessionId}-${lobbyId}`;
    await this.pusher.trigger(channel, "lobby-update", { message });
    console.log(`Published lobby update to Pusher channel: ${channel}`);
  }

  /**
   * Subscribes to lobby updates for real-time notifications.
   * @param sessionId - The session ID.
   * @param lobbyId - The lobby ID.
   * @param callback - The callback function to handle messages.
   */
  async subscribeToLobbyUpdates(
    sessionId: number,
    lobbyId: number,
    callback: (message: string) => void
  ): Promise<void> {
    const channel = this.getLobbyChannel(sessionId, lobbyId);
    await this.redisService.subscribe(channel, callback);
    console.log(`Subscribed to channel: ${channel}`);
  }

  /**
   * Generates a Redis key for a lobby.
   * @param sessionId - The session ID.
   * @param lobbyId - The lobby ID.
   * @returns The Redis key.
   */
  private getLobbyKey(sessionId: number, lobbyId: number): string {
    return `${this.lobbyKeyPrefix}:session:${sessionId}:lobby:${lobbyId}`;
  }

  /**
   * Generates a Pub/Sub channel name for lobby updates.
   * @param sessionId - The session ID.
   * @param lobbyId - The lobby ID.
   * @returns The Pub/Sub channel name.
   */
  private getLobbyChannel(sessionId: number, lobbyId: number): string {
    return `lobby:session:${sessionId}:lobby:${lobbyId}`;
  }

  /**
   * Updates the status of a lobby.
   * @param sessionId - The session ID.
   * @param lobbyId - The lobby ID.
   * @param status - The new status.
   */
  async updateLobbyStatus(
    sessionId: number,
    lobbyId: number,
    status: LobbyStatus
  ): Promise<void> {
    const lobbyKey = this.getLobbyKey(sessionId, lobbyId);
    const lobbyData = await this.redisService.get(lobbyKey);

    if (!lobbyData) {
      throw new Error(`Lobby does not exist for ${lobbyKey}`);
    }

    const lobby: Lobby = JSON.parse(lobbyData);
    lobby.status = status;

    await this.redisService.set(lobbyKey, JSON.stringify(lobby));
    console.log(`Updated lobby ${lobbyId} status to ${status}`);
  }
}
