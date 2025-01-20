import Redis from "ioredis";
import { Redis as RedisKV } from "@upstash/redis";

export class RedisService {
  private keyValueClient: RedisKV;
  private subscriberClient: Redis;

  constructor() {
    const redisConfigKV = {
      url: process.env.REDIS_KV_REST_API_URL || "no val",
      token: process.env.REDIS_KV_REST_API_TOKEN || "no val",
    };

    this.keyValueClient = new RedisKV(redisConfigKV);
    this.subscriberClient = new Redis(
      process.env.REDIS_URL || "redis://localhost:6379"
    );

    this.handleEvents(this.subscriberClient, "Subscriber Client");
  }

  private handleEvents(client: Redis, name: string) {
    client.on("connect", () => console.log(`${name} connected to Redis.`));
    client.on("error", (err) => console.error(`${name} error:`, err));
  }

  // Key-Value Operations
  async set(key: string, value: string): Promise<string | null> {
    return this.keyValueClient.set(key, value);
  }

  async get(key: string): Promise<any | null> {
    return this.keyValueClient.get(key);
  }

  async del(key: string): Promise<number> {
    return this.keyValueClient.del(key);
  }

  // List Operations
  async lpush(key: string, value: string): Promise<number> {
    return this.keyValueClient.lpush(key, value);
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.keyValueClient.lrange(key, start, stop);
  }

  // Set Operations
  async sadd(key: string, members: string[]): Promise<number> {
    if (members.length === 0) {
      throw new Error("No members to add to the set");
    }

    // Pass the first member and the rest as separate arguments
    return this.keyValueClient.sadd(key, members[0], ...members.slice(1));
  }

  async smembers(key: string): Promise<string[]> {
    return this.keyValueClient.smembers(key);
  }

  async sismember(key: string, member: string): Promise<number> {
    return this.keyValueClient.sismember(key, member);
  }

  // Add this method to the RedisService class
  async exists(key: string): Promise<boolean> {
    const result = await this.keyValueClient.exists(key);
    return result > 0; // Redis returns 1 if the key exists, 0 otherwise
  }

  // Flush all data in Redis
  async flushAll(): Promise<void> {
    try {
      // Using the ioredis client to execute the FLUSHALL command
      await this.keyValueClient.flushall();
      console.log("All Redis data has been flushed.");
    } catch (err) {
      console.error("Error flushing Redis data:", err);
      throw err;
    }
  }

  // Subscribe to a channel
  async subscribe(channel: string, callback: (message: string) => void) {
    await this.subscriberClient.subscribe(channel);
    this.subscriberClient.on("message", (receivedChannel, message) => {
      if (receivedChannel === channel) callback(message);
    });
  }

  async unsubscribe(channel: string) {
    return this.subscriberClient.unsubscribe(channel);
  }

  // Cleanup
  async disconnect() {
    await Promise.all([this.subscriberClient.quit()]);
    console.log("All Redis clients disconnected.");
  }
}
