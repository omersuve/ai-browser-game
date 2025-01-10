import Pusher from "pusher";
import { RedisService } from "../redis/RedisService";
import { ForumMessage } from "../types";

export default class ForumService {
  private redisService: RedisService;
  private pusher: Pusher;
  private forumKeyPrefix = "forum"; // Key prefix for forum messages

  constructor(redisService: RedisService, pusher: Pusher) {
    this.redisService = redisService;
    this.pusher = pusher;
  }

  /**
   * Adds a new message to the forum for a lobby.
   * @param lobbyId - The lobby ID.
   * @param message - The forum message to add.
   */
  async addMessage(lobbyId: number, message: ForumMessage): Promise<void> {
    const forumKey = this.getForumKey(lobbyId);

    // Push the message to the forum list
    await this.redisService.lpush(forumKey, JSON.stringify(message));
    console.log(`Added message to lobby ${lobbyId}: ${message.content}`);

    // Notify Pusher for real-time updates
    await this.pusher.trigger(`lobby-${lobbyId}`, "new-message", message);
  }

  /**
   * Retrieves all messages for a lobby.
   * @param lobbyId - The lobby ID.
   * @param limit - Number of messages to fetch (optional).
   * @returns List of forum messages.
   */
  async getMessages(lobbyId: number, limit = 50): Promise<ForumMessage[]> {
    const forumKey = this.getForumKey(lobbyId);

    // Fetch messages from the Redis list
    const rawMessages = await this.redisService.lrange(forumKey, 0, limit - 1);
    return rawMessages.map((msg) => JSON.parse(msg) as ForumMessage);
  }

  /**
   * Clears all messages for a lobby.
   * @param lobbyId - The lobby ID.
   */
  async clearMessages(lobbyId: number): Promise<void> {
    const forumKey = this.getForumKey(lobbyId);
    await this.redisService.del(forumKey);

    console.log(`Cleared messages for lobby ${lobbyId}`);
  }

  /**
   * Publishes a real-time forum update via Pusher.
   * @param lobbyId - The lobby ID.
   * @param message - The forum message to publish.
   */
  async publishForumUpdate(
    lobbyId: number,
    message: ForumMessage
  ): Promise<void> {
    // Trigger the "new-message" event on the Pusher channel corresponding to the lobby
    await this.pusher.trigger(`lobby-${lobbyId}`, "new-message", message);

    // Log the operation
    console.log(`Published message to Pusher channel for lobby ${lobbyId}`);
  }

  /**
   * Subscribes to Redis Pub/Sub for real-time updates (if needed).
   * Note: This may be unnecessary with Pusher.
   * @param lobbyId - The lobby ID.
   * @param callback - Callback function to handle messages.
   */
  async subscribeToForumUpdates(
    lobbyId: number,
    callback: (message: ForumMessage) => void
  ): Promise<void> {
    const channel = this.getForumChannel(lobbyId);

    await this.redisService.subscribe(channel, (rawMessage) => {
      const message = JSON.parse(rawMessage) as ForumMessage;
      callback(message);
    });

    console.log(`Subscribed to forum updates for lobby ${lobbyId}`);
  }

  /**
   * Generates a Redis key for forum messages of a lobby.
   * @param lobbyId - The lobby ID.
   * @returns The Redis key.
   */
  private getForumKey(lobbyId: number): string {
    return `${this.forumKeyPrefix}:lobby:${lobbyId}:messages`;
  }

  /**
   * Generates a Pub/Sub channel name for forum updates.
   * @param lobbyId - The lobby ID.
   * @returns The Pub/Sub channel name.
   */
  private getForumChannel(lobbyId: number): string {
    return `${this.forumKeyPrefix}:lobby:${lobbyId}:channel`;
  }
}
