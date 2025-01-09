import Redis from "ioredis";
import { Redis as RedisKV } from "@upstash/redis";

export class RedisService {
  private keyValueClient: RedisKV;
  private publisherClient: Redis;
  private subscriberClient: Redis;

  constructor() {
    const redisConfig = {
      host: process.env.REDIS_HOST || "127.0.0.1",
      port: parseInt(process.env.REDIS_PORT || "6379", 10),
      password: process.env.REDIS_PASSWORD || undefined,
    };
    const redisConfigKV = {
      url: process.env.REDIS_KV_REST_API_URL || "no val",
      token: process.env.REDIS_KV_REST_API_TOKEN || "no val",
    };

    this.keyValueClient = new RedisKV(redisConfigKV);
    this.publisherClient = new Redis(redisConfig);
    this.subscriberClient = new Redis(redisConfig);

    this.handleEvents(this.publisherClient, "Publisher Client");
    this.handleEvents(this.subscriberClient, "Subscriber Client");
  }

  private handleEvents(client: Redis, name: string) {
    client.on("connect", () => console.log(`${name} connected to Redis.`));
    client.on("error", (err) => console.error(`${name} error:`, err));
  }

  // Key-Value Operations
  async set(key: string, value: string) {
    return this.keyValueClient.set(key, value);
  }

  async get(key: string) {
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

  // Publish to a channel
  async publish(channel: string, message: string) {
    return this.publisherClient.publish(channel, message);
  }

  // Add this method to the RedisService class
  async exists(key: string): Promise<boolean> {
    const result = await this.keyValueClient.exists(key);
    return result > 0; // Redis returns 1 if the key exists, 0 otherwise
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
    await Promise.all([
      this.publisherClient.quit(),
      this.subscriberClient.quit(),
    ]);
    console.log("All Redis clients disconnected.");
  }
}
