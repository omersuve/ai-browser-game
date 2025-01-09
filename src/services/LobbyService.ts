import { RedisService } from "../redis/RedisService";
import { Player, Lobby, LobbyStatus } from "../types";

export default class LobbyService {
  private redisService: RedisService;
  private lobbyKeyPrefix = "lobby"; // Key prefix for lobbies

  constructor(redisService: RedisService) {
    this.redisService = redisService;
  }

  /**
   * Creates a lobby for a session.
   * @param sessionId - The session ID.
   * @param lobbyId - The unique ID for the lobby.
   */
  async createLobby(sessionId: number, lobbyId: number): Promise<void> {
    const lobbyKey = this.getLobbyKey(sessionId, lobbyId);
    const exists = await this.redisService.exists(lobbyKey);

    if (exists) {
      console.warn(`Lobby already exists for ${lobbyKey}`);
      return;
    }

    const lobby: Lobby = {
      id: lobbyId,
      session_id: sessionId,
      players: [],
      created_at: new Date().toISOString(), // Convert to ISO string
      status: LobbyStatus.ACTIVE,
    };

    await this.redisService.set(lobbyKey, JSON.stringify(lobby));
    console.log(`Created lobby: ${lobbyKey}`);
  }

  /**
   * Adds a player to a lobby.
   * @param sessionId - The session ID.
   * @param lobbyId - The lobby ID.
   * @param player - The player to add.
   */
  async addPlayerToLobby(
    sessionId: number,
    lobbyId: number,
    player: Player
  ): Promise<void> {
    const lobbyKey = this.getLobbyKey(sessionId, lobbyId);
    const lobbyData = await this.redisService.get(lobbyKey);

    if (!lobbyData) {
      throw new Error(`Lobby does not exist for ${lobbyKey}`);
    }

    const lobby: Lobby = JSON.parse(lobbyData);
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
   * Publishes a real-time lobby update.
   * @param sessionId - The session ID.
   * @param lobbyId - The lobby ID.
   * @param message - The update message.
   */
  async publishLobbyUpdate(
    sessionId: number,
    lobbyId: number,
    message: string
  ): Promise<void> {
    const channel = this.getLobbyChannel(sessionId, lobbyId);
    await this.redisService.publish(channel, message);
    console.log(`Published update to channel: ${channel}`);
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
}
