import pool from "./db";
import { RedisService } from "./redis/RedisService";
import ApiClient from "./utils/ApiClient";
import LobbyService from "./services/LobbyService";
import ForumService from "./services/ForumService";
import PlayerService from "./services/PlayerService";
import { RitualWorker } from "./core/RitualWorker";

// Load environment variables
import dotenv from "dotenv";
dotenv.config();

(async () => {
  try {
    console.log("Starting Ritual Service...");

    // Initialize Redis service
    const redis = new RedisService();

    // Initialize API client for AI service
    const apiClient = new ApiClient(process.env.AI_API_BASE_URL || "");

    // Initialize additional services
    const lobbyService = new LobbyService(redis);
    const forumService = new ForumService(redis);
    const playerService = new PlayerService(pool, redis);

    // Initialize and start RitualWorker
    const ritualWorker = new RitualWorker(
      pool,
      redis,
      apiClient,
      lobbyService,
      forumService,
      playerService
    );

    await ritualWorker.start();
  } catch (error) {
    console.error("Error starting Ritual Service:", error);
    process.exit(1);
  }
})();
