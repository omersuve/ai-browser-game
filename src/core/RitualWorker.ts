import ApiClient from "../utils/ApiClient";
import TimeUtils from "../utils/TimeUtils";
import { RedisService } from "../redis/RedisService";
import { Pool } from "pg";
import { Session, Round, Player, AIResponse } from "../types";
import LobbyService from "../services/LobbyService";
import ForumService from "../services/ForumService";
import PlayerService from "../services/PlayerService";
import Pusher from "pusher";

export class RitualWorker {
  private db: Pool;
  private redis: RedisService;
  private pusher: Pusher;
  private apiClient: ApiClient;
  private lobbyService: LobbyService;
  private forumService: ForumService;
  private playerService: PlayerService;

  constructor(
    db: Pool,
    redis: RedisService,
    pusher: Pusher,
    apiClient: ApiClient,
    lobbyService: LobbyService,
    forumService: ForumService,
    playerService: PlayerService
  ) {
    this.db = db;
    this.redis = redis;
    this.pusher = pusher;
    this.apiClient = apiClient;
    this.lobbyService = lobbyService;
    this.forumService = forumService;
    this.playerService = playerService;
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
      case "ROUND_END":
        await this.handleRoundEnd(session, event.round);
        break;
      default:
        console.warn("Unknown event type:", event.type);
    }
  }

  // Handle session start
  private async handleSessionStart(session: Session) {
    console.log(`Session ${session.id} started.`);

    // Distribute players into lobbies
    const lobbies = await this.playerService.distributePlayersToLobbies(
      session.id,
      session.max_total_players
    );

    // Create lobbies in Redis
    for (const { lobbyId, players } of lobbies) {
      await this.lobbyService.createLobby(
        session.id,
        lobbyId,
        players // Pass the array of players directly
      );

      // Notify Pusher for each lobby
      await this.pusher.trigger(`lobby-${lobbyId}`, "lobby-created", {
        sessionId: session.id,
        lobbyId,
        players,
      });
    }

    // Notify via Pusher
    await this.pusher.trigger("sessions", "session-start", {
      sessionId: session.id,
      startTime: session.start_time,
    });

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

    // Fetch AI-generated topic message for the round
    const aiTopicResponse = await this.apiClient.post(`/ai/topic`, {
      sessionId: session.id,
      roundId: round.id,
    });

    const topicMessage = aiTopicResponse.data || "Discuss your strategy!";
    console.log("AI Topic Message:", topicMessage);

    // Notify via Pusher about the round start and topic
    await this.pusher.trigger("rounds", "round-start", {
      sessionId: session.id,
      roundNumber: round.round_number,
      startTime: round.start_time,
      topicMessage,
    });

    // Publish round start and AI response
    await this.redis.publish(
      "rounds",
      JSON.stringify({
        type: "ROUND_START",
        sessionId: session.id,
        roundId: round.id,
        topicMessage,
      })
    );
  }

  // Handle round end
  private async handleRoundEnd(session: Session, round: Round) {
    console.log(`Round ${round.round_number} ended for session ${session.id}.`);

    // Retrieve lobbies for the session
    const lobbies = await this.lobbyService.getAllLobbies(session.id);

    const roundDecisions: { lobbyId: number; decision: any }[] = [];

    for (const lobby of lobbies) {
      // Fetch forum messages for the lobby
      const forumMessages = await this.forumService.getMessages(lobby.id);

      // Send messages and remaining players to the AI for decision
      const aiResponse = await this.apiClient.post<AIResponse>(`/ai/decision`, {
        lobby_id: lobby.id,
        forum_messages: forumMessages,
        remaining_players: lobby.players.map((player) => player.wallet_address),
      });

      console.log(`AI Response for lobby ${lobby.id}:`, aiResponse);

      // Process AI decision
      const eliminatedPlayers = aiResponse.data?.eliminatedPlayers || [];
      const announcement =
        aiResponse.data?.announcement || "No elimination this round.";

      // Update Redis for the lobby
      lobby.players = lobby.players.filter(
        (player) => !eliminatedPlayers.includes(player.wallet_address)
      );
      await this.lobbyService.updateLobby(session.id, lobby.id, lobby);

      // Notify players in the lobby via Pusher
      await this.pusher.trigger(`lobby-${lobby.id}`, "round-end", {
        announcement,
        eliminatedPlayers,
      });

      // Record the decision for the round
      roundDecisions.push({ lobbyId: lobby.id, decision: aiResponse.data });

      console.log(`Processed round-end for lobby ${lobby.id}`);
    }

    // Log the round decisions or save them to the database if needed
    console.log(`Round ${round.round_number} decisions:`, roundDecisions);

    // Notify via Pusher at the session level
    await this.pusher.trigger("sessions", "round-end", {
      sessionId: session.id,
      roundNumber: round.round_number,
      decisions: roundDecisions,
    });

    console.log(`Round ${round.round_number} ended and decisions published.`);
  }

  // Handle session end
  private async handleSessionEnd(session: Session) {
    console.log(`Session ${session.id} ended.`);

    // Notify via Pusher
    await this.pusher.trigger("sessions", "session-end", {
      sessionId: session.id,
      endTime: session.end_time,
    });

    await this.redis.publish(
      "sessions",
      JSON.stringify({ type: "SESSION_END", sessionId: session.id })
    );
  }
}
