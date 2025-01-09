import ApiClient from "../utils/ApiClient";
import TimeUtils from "../utils/TimeUtils";
import { RedisService } from "../redis/RedisService";
import { Pool } from "pg"; // For database queries
import { Session, Round } from "../types";

export class RitualWorker {
  private db: Pool;
  private redis: RedisService;
  private apiClient: ApiClient;

  constructor(db: Pool, redis: RedisService, apiClient: ApiClient) {
    this.db = db;
    this.redis = redis;
    this.apiClient = apiClient;
  }

  // Start monitoring sessions and rounds
  async start() {
    console.log("RitualWorker started...");
    while (true) {
      try {
        await this.monitorSessions();
      } catch (error) {
        console.error("Error in RitualWorker loop:", error);
      }
    }
  }

  // Monitor sessions and rounds
  private async monitorSessions() {
    const activeSessions = await this.fetchActiveSessions();

    if (activeSessions.length === 0) {
      console.log("No active sessions. Sleeping...");
      await TimeUtils.sleep(60000); // Sleep for 1 minute if no sessions are active
      return;
    }

    for (const session of activeSessions) {
      const nextEvent = this.getNextEvent(session);
      if (nextEvent) {
        console.log(
          `Next event for session ${session.id}: ${
            nextEvent.type
          } at ${new Date(nextEvent.time)}`
        );
        await TimeUtils.sleepUntil(nextEvent.time);
        await this.processEvent(session, nextEvent);
      }
    }
  }

  // Fetch active sessions from the database
  private async fetchActiveSessions(): Promise<Session[]> {
    const result = await this.db.query<Session>(
      "SELECT * FROM sessions WHERE end_time > NOW() ORDER BY start_time ASC"
    );
    return result.rows;
  }

  private async getAIResponse(data: any): Promise<any> {
    const response = await this.apiClient.post("/ai/response", data);
    return response.data;
  }

  // Determine the next event for a session
  private getNextEvent(session: Session) {
    const now = Date.now();
    const startTime = new Date(session.start_time).getTime();
    const endTime = new Date(session.end_time).getTime();

    if (now < startTime) {
      return { type: "SESSION_START", time: startTime };
    } else if (now >= startTime && now < endTime) {
      const nextRound = this.getNextRound(session.rounds || [], now);
      if (nextRound) {
        return {
          type: "ROUND_START",
          time: new Date(nextRound.start_time).getTime(),
          round: nextRound,
        };
      }
      return { type: "SESSION_END", time: endTime };
    }
    return null;
  }

  // Find the next round that hasn't started yet
  private getNextRound(rounds: Round[], now: number): Round | null {
    return (
      rounds.find((round) => new Date(round.start_time).getTime() > now) || null
    );
  }

  private async fetchUpcomingSessions(): Promise<Session[]> {
    const sessions = await this.apiClient.get<Session[]>("/sessions/upcoming");
    return sessions.data || [];
  }

  // Process an event (e.g., session start, round start, session end)
  private async processEvent(session: Session, event: any) {
    switch (event.type) {
      case "SESSION_START":
        await this.handleSessionStart(session);
        break;
      case "ROUND_START":
        await this.handleRoundStart(session, event.round);
        break;
      case "SESSION_END":
        await this.handleSessionEnd(session);
        break;
      default:
        console.warn("Unknown event type:", event.type);
    }
  }

  // Handle session start
  private async handleSessionStart(session: Session) {
    console.log(`Session ${session.id} started.`);
    await this.redis.publish(
      "sessions",
      JSON.stringify({ type: "SESSION_START", sessionId: session.id })
    );
  }

  // Handle round start
  private async handleRoundStart(session: Session, round: Round) {
    console.log(
      `Round ${round.round_number} started for session ${session.id}.`
    );
    // Example: Trigger AI API and publish updates
    const aiResponse = await this.apiClient.post(`/ai/decision`, {
      sessionId: session.id,
      roundId: round.id,
    });
    console.log("AI Response:", aiResponse);

    // Publish round start and AI response
    await this.redis.publish(
      "rounds",
      JSON.stringify({
        type: "ROUND_START",
        sessionId: session.id,
        roundId: round.id,
        aiResponse,
      })
    );
  }

  // Handle session end
  private async handleSessionEnd(session: Session) {
    console.log(`Session ${session.id} ended.`);
    await this.redis.publish(
      "sessions",
      JSON.stringify({ type: "SESSION_END", sessionId: session.id })
    );
  }
}
