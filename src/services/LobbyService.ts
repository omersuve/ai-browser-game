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
   * Retrieves the voting results for a specific lobby and round.
   * @param sessionId - The session ID.
   * @param lobbyId - The lobby ID.
   * @param roundId - The round ID.
   * @returns An object summarizing the voting results.
   */
  async getVotingResults(
    sessionId: number,
    lobbyId: number,
    roundId: number
  ): Promise<{ [key: string]: number }> {
    const votingKey = `voting:session:${sessionId}:lobby:${lobbyId}:round:${roundId}`;

    // Fetch all votes stored under the key
    const votes = await this.redisService.lrange(votingKey, 0, -1);

    if (!votes || votes.length === 0) {
      console.warn(`No votes found for ${votingKey}`);
      return {};
    }

    // Count votes
    const results: { [key: string]: number } = {};
    for (const vote of votes) {
      results[vote] = (results[vote] || 0) + 1;
    }

    console.log(`Voting results for ${votingKey}:`, results);
    return results;
  }

  /**
   * Retrieves the remaining players in all active lobbies of a session.
   * @param sessionId - The session ID.
   * @returns An array of remaining players across all lobbies.
   */
  async getRemainingPlayersByLobby(
    sessionId: number,
    lobbyId: number
  ): Promise<Player[]> {
    const lobby = await this.getLobby(sessionId, lobbyId);

    if (!lobby) {
      throw new Error(
        `Lobby ${lobbyId} does not exist in session ${sessionId}.`
      );
    }

    if (lobby.status !== LobbyStatus.ACTIVE) {
      console.log(`Lobby ${lobbyId} is not active.`);
      return [];
    }

    console.log(
      `Found ${lobby.players.length} remaining players in lobby ${lobbyId} of session ${sessionId}.`
    );

    return lobby.players;
  }

  /**
   * Retrieves lobby data.
   * @param sessionId - The session ID.
   * @param lobbyId - The lobby ID.
   * @returns The lobby data.
   */
  async getLobby(sessionId: number, lobbyId: number): Promise<Lobby | null> {
    const lobbyKey = this.getLobbyKey(sessionId, lobbyId);
    const lobbyData: Lobby | null = await this.redisService.get(lobbyKey);
    return lobbyData;
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
   * Retrieves all active lobbies for a given session.
   * @param sessionId - The session ID.
   * @returns An array of active lobbies.
   */
  async getActiveLobbies(sessionId: number): Promise<Lobby[]> {
    const allLobbies = await this.getAllLobbies(sessionId); // Fetch all lobbies
    const activeLobbies = allLobbies.filter(
      (lobby) => lobby.status === LobbyStatus.ACTIVE
    );

    console.log(
      `Retrieved ${activeLobbies.length} active lobbies for session ${sessionId}.`
    );

    return activeLobbies;
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
    lobby: Lobby
  ): Promise<void> {
    const lobbyKey = this.getLobbyKey(sessionId, lobbyId);

    if (!lobby) {
      throw new Error(`Lobby does not exist for ${lobbyKey}`);
    }

    // Save the updated lobby back to Redis
    await this.redisService.set(lobbyKey, JSON.stringify(lobby));

    console.log(`Lobby ${lobbyId} updated for session ${sessionId}`);
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

    lobbyData.status = status;

    await this.redisService.set(lobbyKey, JSON.stringify(lobbyData));
    console.log(`Updated lobby ${lobbyId} status to ${status}`);
  }
}
