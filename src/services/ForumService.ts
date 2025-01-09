import { RedisService } from "../redis/RedisService";
import { ForumMessage } from "../types";

export default class ForumService {
  private redisService: RedisService;
  private forumKeyPrefix = "forum"; // Key prefix for forum messages

  constructor(redisService: RedisService) {
    this.redisService = redisService;
  }

  /**
   * Adds a new message to the forum for a session.
   * @param sessionId - The session ID.
   * @param message - The forum message to add.
   */
  async addMessage(sessionId: number, message: ForumMessage): Promise<void> {
    const forumKey = this.getForumKey(sessionId);

    // Push the message to the forum list
    await this.redisService.lpush(forumKey, JSON.stringify(message));
    console.log(`Added message to session ${sessionId}: ${message.content}`);
  }

  /**
   * Retrieves all messages for a session.
   * @param sessionId - The session ID.
   * @param limit - Number of messages to fetch (optional).
   * @returns List of forum messages.
   */
  async getMessages(sessionId: number, limit = 50): Promise<ForumMessage[]> {
    const forumKey = this.getForumKey(sessionId);

    // Fetch messages from the Redis list
    const rawMessages = await this.redisService.lrange(forumKey, 0, limit - 1);
    return rawMessages.map((msg) => JSON.parse(msg) as ForumMessage);
  }

  /**
   * Clears all messages for a session.
   * @param sessionId - The session ID.
   */
  async clearMessages(sessionId: number): Promise<void> {
    const forumKey = this.getForumKey(sessionId);
    await this.redisService.del(forumKey);
    console.log(`Cleared messages for session ${sessionId}`);
  }

  /**
   * Publishes a real-time forum update.
   * @param sessionId - The session ID.
   * @param message - The forum message to publish.
   */
  async publishForumUpdate(
    sessionId: number,
    message: ForumMessage
  ): Promise<void> {
    const channel = this.getForumChannel(sessionId);
    await this.redisService.publish(channel, JSON.stringify(message));
    console.log(`Published message to channel ${channel}`);
  }

  /**
   * Subscribes to forum updates for a session.
   * @param sessionId - The session ID.
   * @param callback - Callback function to handle messages.
   */
  async subscribeToForumUpdates(
    sessionId: number,
    callback: (message: ForumMessage) => void
  ): Promise<void> {
    const channel = this.getForumChannel(sessionId);

    await this.redisService.subscribe(channel, (rawMessage) => {
      const message = JSON.parse(rawMessage) as ForumMessage;
      callback(message);
    });

    console.log(`Subscribed to forum updates for session ${sessionId}`);
  }

  /**
   * Generates a Redis key for forum messages of a session.
   * @param sessionId - The session ID.
   * @returns The Redis key.
   */
  private getForumKey(sessionId: number): string {
    return `${this.forumKeyPrefix}:session:${sessionId}:messages`;
  }

  /**
   * Generates a Pub/Sub channel name for forum updates.
   * @param sessionId - The session ID.
   * @returns The Pub/Sub channel name.
   */
  private getForumChannel(sessionId: number): string {
    return `${this.forumKeyPrefix}:session:${sessionId}:channel`;
  }
}
