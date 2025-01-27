import pool from "./db";
import pusher from "./lib/pusher";
import { RedisService } from "./redis/RedisService";
import ApiClient from "./utils/ApiClient";
import LobbyService from "./services/LobbyService";
import SessionService from "./services/SessionService";
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
    const lobbyService = new LobbyService(redis, pusher);
    const sessionService = new SessionService(pool, pusher);
    const playerService = new PlayerService(pool, redis, pusher);

    // Initialize and start RitualWorker
    const ritualWorker = new RitualWorker(
      pool,
      redis,
      pusher,
      apiClient,
      lobbyService,
      sessionService,
      playerService
    );

    await ritualWorker.start();
  } catch (error) {
    console.error("Error starting Ritual Service:", error);
    process.exit(1);
  }
})();
