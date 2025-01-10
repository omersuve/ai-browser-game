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

    // Fetch the next scheduled session
    let nextSession = await this.fetchNextSession();

    while (true) {
      if (nextSession) {
        console.log(
          `Next session found: ${nextSession.id}, starting monitoring.`
        );
        await this.monitorSession(nextSession);
      } else {
        console.log("No upcoming sessions. Waiting for session creation...");
      }

      // Wait for the next session notification
      nextSession = await this.waitForNextSession();
    }
  }

  private async fetchNextSession(): Promise<Session | null> {
    const result = await this.db.query<Session>(
      `SELECT * FROM sessions 
       WHERE start_time > NOW() 
       ORDER BY start_time ASC 
       LIMIT 1`
    );
    return result.rows[0] || null;
  }

  private async waitForNextSession(): Promise<Session | null> {
    return new Promise((resolve) => {
      this.redis.subscribe("new-session", async (message) => {
        const { sessionId } = JSON.parse(message);
        console.log(`New session created: ${sessionId}`);
        const session = await this.fetchSessionById(sessionId);
        resolve(session);
      });
    });
  }

  private async monitorSession(session: Session) {
    console.log(`Monitoring session ${session.id}...`);

    while (true) {
      const nextEvent = this.getNextEvent(session);
      if (!nextEvent) {
        console.log(`Session ${session.id} has no more events.`);
        break;
      }

      console.log(`Next event for session ${session.id}: ${nextEvent.type}`);
      await TimeUtils.sleepUntil(nextEvent.time);
      await this.processEvent(session, nextEvent);
    }

    console.log(`Session ${session.id} monitoring completed.`);
  }

  private async fetchSessionById(sessionId: number): Promise<Session | null> {
    // Query for the session
    const sessionQuery = `
      SELECT * FROM sessions WHERE id = $1;
    `;
    const sessionResult = await this.db.query<Session>(sessionQuery, [
      sessionId,
    ]);

    if (sessionResult.rows.length === 0) {
      console.warn(`Session with ID ${sessionId} not found.`);
      return null;
    }

    const session = sessionResult.rows[0];

    // Query for the rounds associated with the session
    const roundsQuery = `
      SELECT * FROM rounds WHERE session_id = $1 ORDER BY round_number ASC;
    `;
    const roundsResult = await this.db.query<Round>(roundsQuery, [sessionId]);

    // Query for the players associated with the session
    const playersQuery = `
      SELECT * FROM players WHERE session_id = $1 ORDER BY joined_at ASC;
    `;
    const playersResult = await this.db.query<Player>(playersQuery, [
      sessionId,
    ]);

    // Combine session, rounds, and players into a single object
    return {
      ...session,
      rounds: roundsResult.rows,
      players: playersResult.rows,
    };
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
