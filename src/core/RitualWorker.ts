import ApiClient from "../utils/ApiClient";
import TimeUtils from "../utils/TimeUtils";
import { RedisService } from "../redis/RedisService";
import { Pool } from "pg";
import {
  Session,
  Round,
  Player,
  AIResponse,
  Lobby,
  LobbyStatus,
} from "../types";
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

  async start() {
    console.log("RitualWorker started...");

    while (true) {
      // Fetch the currently active session or the next scheduled session

      const nextActiveSession = await this.getActiveSession();
      console.log("nextActiveSession", nextActiveSession);

      const nextUpcomingSession = await this.fetchNextSession();
      console.log("nextUpcomingSession", nextUpcomingSession);

      console.log("now", new Date().toISOString());

      let nextSession;

      if (nextActiveSession) {
        nextSession = nextActiveSession;
      } else if (nextUpcomingSession) {
        nextSession = nextUpcomingSession;
      }

      console.log("nextSession is", nextSession);

      if (!nextSession) {
        console.log(
          "No active or upcoming sessions. Waiting for a new session..."
        );
        nextSession = await this.waitForNextSession(); // Wait for Redis event
      }

      // Ensure nextSession is not null
      if (!nextSession) {
        console.log("Still no session found. Continuing to wait...");
        continue;
      }

      console.log(`Monitoring session: ${nextSession.id}`);

      // Monitor the session
      await this.monitorSession(nextSession);
    }
  }

  private async getActiveSession(): Promise<Session | null> {
    const result = await this.db.query<Session>(
      `SELECT id, name, entry_fee, total_rounds, max_total_players, 
            start_time AT TIME ZONE 'UTC' AS start_time, 
            end_time AT TIME ZONE 'UTC' AS end_time, 
            created_at AT TIME ZONE 'UTC' AS created_at 
     FROM sessions 
     WHERE start_time <= NOW() AT TIME ZONE 'UTC' AND end_time >= NOW() AT TIME ZONE 'UTC' 
     LIMIT 1`
    );
    return result.rows[0] || null;
  }

  private async fetchNextSession(): Promise<Session | null> {
    const result = await this.db.query<Session>(
      `SELECT id, name, entry_fee, total_rounds, max_total_players, 
            start_time AT TIME ZONE 'UTC' AS start_time, 
            end_time AT TIME ZONE 'UTC' AS end_time, 
            created_at AT TIME ZONE 'UTC' AS created_at 
     FROM sessions 
     WHERE start_time > NOW() AT TIME ZONE 'UTC' 
     ORDER BY start_time ASC 
     LIMIT 1`
    );
    return result.rows[0] || null;
  }

  private async waitForNextSession(): Promise<Session | null> {
    return new Promise(async (resolve) => {
      this.redis.subscribe("new-session", async (message) => {
        const { sessionId } = JSON.parse(message);
        const newSession = await this.fetchSessionById(sessionId);

        console.log("newSession", newSession);

        if (!newSession) {
          console.warn(`New session with ID ${sessionId} not found.`);
          resolve(null);
          return;
        }

        await this.pusher.trigger("sessions", "new-session", {
          sessionId: newSession.id,
          startTime: newSession.start_time,
          endTime: newSession.end_time,
          name: newSession.name,
        });

        resolve(newSession);
      });
    });
  }

  private async monitorSession(session: Session) {
    console.log("session", session);

    while (true) {
      const nextEvent = this.getNextEvent(session);
      if (!nextEvent) {
        break;
      }
      console.log(`Next event for session ${session.id}: ${nextEvent.type}`);

      await TimeUtils.sleepUntil(nextEvent.time); // SLEEP UNTIL NEXT EVENT

      await this.processEvent(session, nextEvent);

      if (nextEvent.type === "SESSION_END") {
        break; // No need to process further after session ends
      }
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

    console.log("now (UTC):", new Date(now).toISOString());
    console.log("start_time (UTC):", new Date(startTime).toISOString());
    console.log("end_time (UTC):", new Date(endTime).toISOString());

    if (now < startTime) {
      return { type: "SESSION_START", time: startTime };
    } else if (now >= startTime && now < endTime) {
      const nextRound = this.getNextEventRound(session.rounds || [], now);
      console.log("nextRound", nextRound);
      if (nextRound) {
        const roundStartTime = new Date(nextRound.start_time).getTime();
        const roundEndTime = new Date(nextRound.end_time).getTime();
        console.log("now", now.toLocaleString());
        console.log("roundStartTime", roundStartTime.toLocaleString());
        console.log("roundEndTime", roundEndTime.toLocaleString());

        if (now < roundStartTime) {
          return {
            type: "ROUND_START",
            time: roundStartTime,
            round: nextRound,
          };
        } else if (now >= roundStartTime && now < roundEndTime) {
          return {
            type: "ROUND_END",
            time: roundEndTime,
            round: nextRound,
          };
        }
      }
      return { type: "SESSION_END", time: endTime };
    } else {
      console.log(`Session ${session.id} is already over.`);
      return null; // No more events for this session
    }
  }

  // Find the next round that hasn't started yet
  private getNextEventRound(rounds: Round[], now: number): Round | null {
    return (
      rounds.find(
        (round) =>
          (new Date(round.start_time).getTime() <= now &&
            new Date(round.end_time).getTime() > now) ||
          new Date(round.start_time).getTime() > now
      ) || null
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
        // First round skips AI decision and voting
        if (event.round.round_number > 1) {
          console.log("AI decision phase (1 minute)...");

          console.log("Voting phase (1 minute)...");
          await this.handleVotingPhase(session, event.round); // Implement voting logic
        }
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

    // Fetch players for the session
    const players = await this.playerService.getPlayers(session.id);

    if (players.length === 0) {
      console.warn(`No players found for session ${session.id}.`);
      return; // Exit early as there are no players to process
    }

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

  // Handle voting phase
  private async handleVotingPhase(session: Session, lobby: Lobby) {
    console.log(`Voting phase started for lobby ${lobby.id}.`);

    // Notify players about the voting phase
    await this.pusher.trigger(`lobby-${lobby.id}`, "voting-start", {
      lobbyId: lobby.id,
      message: "Vote to continue the game or share the prize.",
    });

    // Initialize Redis key for voting
    const votingKey = `session:${session.id}:lobby:${lobby.id}:votes`;
    await this.redis.del(votingKey); // Clear any existing votes

    // Fetch votes from Redis
    const yesVotes = await this.redis.smembers(`${votingKey}:yes`);
    const noVotes = await this.redis.smembers(`${votingKey}:no`);

    console.log(
      `Votes for lobby ${lobby.id}: YES=${yesVotes.length}, NO=${noVotes.length}`
    );

    if (noVotes.length >= yesVotes.length) {
      // Majority voted to continue
      console.log(`Lobby ${lobby.id} voted to continue.`);
      await this.pusher.trigger(`lobby-${lobby.id}`, "voting-result", {
        lobbyId: lobby.id,
        result: "continue",
      });
    } else {
      // Majority voted to share the prize
      console.log(`Lobby ${lobby.id} voted to share the prize.`);
      await this.pusher.trigger(`lobby-${lobby.id}`, "voting-result", {
        lobbyId: lobby.id,
        result: "share",
      });

      // End the session for this lobby
      await this.lobbyService.updateLobbyStatus(
        session.id,
        lobby.id,
        LobbyStatus.COMPLETED
      );
    }
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

    // Redis cleanup: remove all keys related to the session and its lobbies
    try {
      console.log(`Cleaning up Redis data for session ${session.id}...`);

      // Remove session-specific data
      await this.redis.del(`session:${session.id}`);

      // Remove all lobby-specific data
      const lobbies = await this.lobbyService.getAllLobbies(session.id);
      for (const lobby of lobbies) {
        await this.redis.del(`lobby:${lobby.id}:players`);
        await this.redis.del(`lobby:${lobby.id}:votes`);
        await this.redis.del(`lobby:${lobby.id}`);
      }

      console.log(`Redis data for session ${session.id} cleaned up.`);
    } catch (err) {
      console.error(
        `Failed to clean up Redis data for session ${session.id}:`,
        err
      );
    }
  }
}
