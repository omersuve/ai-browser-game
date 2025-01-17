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

    // Notify via Pusher
    await this.pusher.trigger(`lobby-${lobbyId}`, "forum-clear", {
      lobbyId,
      message: "All forum messages have been cleared.",
    });

    console.log(`Cleared messages for lobby ${lobbyId}`);
  }

  /**
   * Generates a Redis key for forum messages of a lobby.
   * @param lobbyId - The lobby ID.
   * @returns The Redis key.
   */
  private getForumKey(lobbyId: number): string {
    return `${this.forumKeyPrefix}:lobby:${lobbyId}:messages`;
  }
}
