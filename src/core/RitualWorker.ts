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
  PLAYER_STATUS,
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
  private agentId: string;

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
    this.agentId = "36a03003-5d9b-0f41-ac69-85e98679b3e8";
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

    // Check if the session has already ended
    if (now >= new Date(session.end_time).getTime()) {
      console.log(`Session ${session.id} is already over.`);
      return null;
    }

    const events: { type: string; time: number; round?: Round }[] = [];
    const rounds = session.rounds || [];

    // Add session start and end events
    if (now < new Date(session.start_time).getTime()) {
      events.push({
        type: "SESSION_START",
        time: new Date(session.start_time).getTime(),
      });
    }

    events.push({
      type: "SESSION_END",
      time: new Date(session.end_time).getTime(),
    });

    // Add all round-related events
    for (const round of rounds) {
      events.push(
        {
          type: "AI_MESSAGE_START",
          time: new Date(round.ai_message_start).getTime(),
          round,
        },
        {
          type: "AI_MESSAGE_END",
          time: new Date(round.ai_message_end).getTime(),
          round,
        },
        {
          type: "ROUND_START",
          time: new Date(round.start_time).getTime(),
          round,
        },
        { type: "ROUND_END", time: new Date(round.end_time).getTime(), round },
        {
          type: "ELIMINATION_START",
          time: new Date(round.elimination_start).getTime(),
          round,
        },
        {
          type: "ELIMINATION_END",
          time: new Date(round.elimination_end).getTime(),
          round,
        },
        {
          type: "VOTING_START",
          time: new Date(round.voting_start_time).getTime(),
          round,
        },
        {
          type: "VOTING_END",
          time: new Date(round.voting_end_time).getTime(),
          round,
        }
      );
    }

    // Find the next event based on the current time
    const nextEvent = events
      .filter((event) => event.time > now) // Only future events
      .sort((a, b) => a.time - b.time)[0]; // Find the closest event

    return nextEvent || null;
  }

  private async processEvent(session: Session, event: any) {
    switch (event.type) {
      case "SESSION_START":
        await this.handleSessionStart(session);
        break;

      case "AI_MESSAGE_START":
        await this.handleAiMessageStart(session, event.round);
        break;

      case "AI_MESSAGE_END":
        await this.handleAiMessageEnd(session, event.round);
        console.log("Round started", event.round.round_number);
        await this.handleRoundStart(session, event.round);
        break;

      case "ROUND_END":
        await this.handleRoundEnd(session, event.round);
        console.log("Starting elimination phase...");
        await this.handleEliminationStart(session, event.round);

      case "ELIMINATION_END":
        await this.handleEliminationEnd(session, event.round);
        // Fetch remaining players for each active lobby
        const activeLobbies = await this.lobbyService.getActiveLobbies(
          session.id
        );

        for (const lobby of activeLobbies) {
          const remainingPlayers =
            await this.lobbyService.getRemainingPlayersByLobby(
              session.id,
              lobby.id
            );

          if (remainingPlayers.length === 1) {
            console.log(
              `Only one player left in lobby ${lobby.id}. Ending game for this lobby.`
            );

            // Mark the lobby as completed
            await this.lobbyService.updateLobbyStatus(
              session.id,
              lobby.id,
              LobbyStatus.COMPLETED
            );

            // Notify via Pusher
            await this.pusher.trigger(`lobby-${lobby.id}`, "game-end", {
              lobbyId: lobby.id,
              message: "Only one player left. The game has ended.",
            });
          }
        }

        await this.handleVotingStart(session, event.round);

        break;

      case "VOTING_END":
        await this.handleVotingEnd(session, event.round);
        await this.handleAiMessageStart(session, event.round);
        break;

      case "SESSION_END":
        await this.handleSessionEnd(session);
        break;

      default:
        console.warn("Unknown event type:", event.type);
    }
  }

  private async handleEliminationStart(session: Session, round: Round) {
    console.log(
      `Elimination phase started for round ${round.round_number} in session ${session.id}.`
    );

    // Retrieve lobbies for the session
    const lobbies = await this.lobbyService.getActiveLobbies(session.id);
    console.log("lobbies:", lobbies);

    for (const lobby of lobbies) {
      // Send messages and remaining players to the AI for decision
      const aiResponse = await this.apiClient.post<AIResponse>(
        `/decideEliminations`,
        {
          agentId: this.agentId,
          sessionId: session.id,
          lobbyId: lobby.id,
          maxRounds: session.total_rounds,
          currentRound: round.round_number,
        }
      );

      console.log(`AI Response for lobby ${lobby.id}:`, aiResponse);

      // Extract AI decisions
      const eliminatedPlayers = aiResponse.data?.response || [];
      console.log("Eliminated Players", eliminatedPlayers);

      // Update lobby players (set eliminated status)
      lobby.players = lobby.players.map((player) => {
        if (
          eliminatedPlayers.some(
            (item) => item.participant === player.wallet_address
          )
        ) {
          const playerKey = `lobby:${lobby.id}:player:${player.wallet_address}`;
          this.redis.set(
            playerKey,
            JSON.stringify({
              status: PLAYER_STATUS.ELIMINATED,
            })
          );
          console.log(`Updated Redis for eliminated player: ${playerKey}`);
          // Mark the player as eliminated
          return {
            ...player,
            status: PLAYER_STATUS.ELIMINATED,
          };
        }
        return player; // Keep other players unchanged
      });

      console.log("Lobby players after eliminated Players", lobby.players);


      await this.lobbyService.updateLobby(session.id, lobby.id, lobby);

      let combinedEliminations = [];

      // Store in Redis
      const redisKey = `elimination:lobby:${lobby.id}`;
      const existingEliminations = await this.redis.get(redisKey) || {};

      combinedEliminations = existingEliminations.eliminatedPlayers || [];

      combinedEliminations = [...combinedEliminations, ...eliminatedPlayers];


      await this.redis.set(redisKey, JSON.stringify({ eliminatedPlayers: combinedEliminations }));


      // Notify players via Pusher
      await this.pusher.trigger(`lobby-${lobby.id}`, "elimination-start", {
        eliminatedPlayers,
      });

      console.log(`Elimination processed for lobby ${lobby.id}.`);
    }
  }

  private async handleEliminationEnd(
    session: Session,
    round: Round
  ): Promise<void> {
    console.log(
      `Elimination phase ended for round ${round.round_number} in session ${session.id}.`
    );

    // Fetch all active lobbies
    const activeLobbies = await this.lobbyService.getActiveLobbies(session.id);

    if (activeLobbies.length === 0) {
      console.log(
        `No active lobbies for elimination in session ${session.id}.`
      );
      return;
    }

    for (const lobby of activeLobbies) {
      // Notify players about the end of the elimination phase
      await this.pusher.trigger(`lobby-${lobby.id}`, "elimination-end", {
        lobbyId: lobby.id,
        message: "Elimination phase has ended. Prepare for the next phase.",
        remainingParticipants: lobby.players.map(
          (player) => player.wallet_address
        ), // Include remaining participants
      });

      console.log(`Lobby ${lobby.id}: Elimination phase concluded.`);
    }

    console.log(`Elimination phase for round ${round.round_number} completed.`);
  }

  private async handleAiMessageEnd(
    session: Session,
    round: Round
  ): Promise<void> {
    console.log(
      `AI message phase ended for round ${round.round_number} in session ${session.id}.`
    );

    // Notify players in the session about the AI message conclusion
    await this.pusher.trigger("rounds", "ai-message-end", {
      sessionId: session.id,
      roundNumber: round.round_number,
      message: "AI message phase has concluded. Prepare for the next phase.",
    });

    console.log(
      `AI message phase concluded for round ${round.round_number} in session ${session.id}.`
    );
  }

  private async handleAiMessageStart(session: Session, round: Round) {
    console.log(
      `AI message phase started for round ${round.round_number} in session ${session.id}.`
    );

    // Fetch AI-generated topic message
    const aiTopicResponse = await this.apiClient.get(
      `/${this.agentId}/roundAnnouncement/${round.round_number}` // TODO: ADD LOBBY
    );

    console.log("AI Topic Message:", aiTopicResponse);

    // Notify via Pusher about the AI topic message
    await this.pusher.trigger("rounds", "ai-message-start", {
      sessionId: session.id,
      round: round,
    });

    console.log(`AI message for round ${round.round_number} published.`);
  }

  private async handleSessionStart(session: Session) {
    console.log(`Session ${session.id} started.`);

    // Redis cleanup: remove all keys related to the session and its lobbies
    try {
      console.log(`Cleaning up Redis data for session ${session.id}...`);
      await this.redis.flushAll();
    } catch (err) {
      console.error(
        `Failed to clean up Redis data for session ${session.id}:`,
        err
      );
    }

    // Fetch players for the session
    const players = await this.playerService.getPlayers(session.id);

    if (players.length === 0) {
      console.warn(`No players found for session ${session.id}.`);
      return; // Exit early as there are no players to process
    }

    // Distribute players into lobbies
    this.playerService
      .distributePlayersToLobbies(session.id, session.max_total_players)
      .then((lobbies) => {
        if (lobbies.length === 0) {
          console.warn(
            `No lobbies created for session ${session.id} due to no players.`
          );
          return; // Exit early as there are no lobbies to process
        }

        console.log("lobbies:", lobbies);

        // Notify via Pusher
        this.pusher
          .trigger("sessions", "session-start", {
            sessionId: session.id,
            startTime: session.start_time,
          })
          .then(() => {
            console.log("pusher for session start sent!!!!!!!!!!!!!!!!!!!!!");
          });
      });
  }

  private async handleRoundStart(session: Session, round: Round) {
    console.log(
      `Round ${round.round_number} started for session ${session.id}.`
    );

    // Notify via Pusher about the round start
    await this.pusher.trigger("rounds", "round-start", {
      sessionId: session.id,
      roundNumber: round.round_number,
      startTime: round.start_time,
    });

    console.log(`Round ${round.round_number} initialization complete.`);
  }

  private async handleRoundEnd(session: Session, round: Round) {
    console.log(`Round ${round.round_number} ended for session ${session.id}.`);

    // Perform any round finalization logic
    console.log(`Round ${round.round_number} finalized.`);

    // Notify via Pusher
    await this.pusher.trigger("sessions", "round-end", {
      sessionId: session.id,
      roundNumber: round.round_number,
    });

    console.log(`Round ${round.round_number} ended and notifications sent.`);
  }

  private async handleVotingStart(session: Session, round: Round) {
    console.log(
      `Voting started for round ${round.round_number} in session ${session.id}.`
    );

    // Notify players about the voting phase
    await this.pusher.trigger("rounds", "voting-start", {
      sessionId: session.id,
      roundNumber: round.round_number,
      votingStartTime: round.voting_start_time,
      votingEndTime: round.voting_end_time,
    });

    // Initialize voting storage (optional, based on Redis design)
    const lobbies = await this.lobbyService.getActiveLobbies(session.id);
    for (const lobby of lobbies) {
      const votingKey = `voting:session:${session.id}:lobby:${lobby.id}:round:${round.id}`;
      await this.redis.del(votingKey); // Clear any previous votes
    }
  }

  private async handleVotingEnd(session: Session, round: Round): Promise<void> {
    console.log(
      `Voting ended for round ${round.round_number} in session ${session.id}.`
    );

    const activeLobbies = await this.lobbyService.getActiveLobbies(session.id);

    if (activeLobbies.length === 0) {
      console.log("No active lobbies found for voting.");
      return;
    }

    for (const lobby of activeLobbies) {
      const lobbyResults = await this.lobbyService.getVotingResults(
        session.id,
        lobby.id,
        round.id
      );

      if (!lobbyResults) {
        console.warn(`No voting results found for lobby ${lobby.id}.`);
        continue;
      }

      // Calculate votes for "continue" and "end"
      const continueVotes = lobbyResults["continue"] || 0;
      const shareVotes = lobbyResults["share"] || 0;

      console.log(
        `Lobby ${lobby.id} voting results: CONT=${continueVotes}, END=${shareVotes}`
      );
      // Determine the outcome for the lobby
      if (continueVotes >= shareVotes) {
        // Majority voted to continue
        console.log(`Lobby ${lobby.id} voted to continue.`);
        await this.pusher.trigger(`lobby-${lobby.id}`, "voting-result", {
          lobbyId: lobby.id,
          result: "continue",
        });
      } else {
        // Majority voted to end the lobby
        console.log(`Lobby ${lobby.id} voted to end and share the prize.`);
        await this.pusher.trigger(`lobby-${lobby.id}`, "voting-result", {
          lobbyId: lobby.id,
          result: "share",
        });

        // Update lobby status to completed
        await this.lobbyService.updateLobbyStatus(
          session.id,
          lobby.id,
          LobbyStatus.COMPLETED
        );

        await this.handleSessionEnd(session);
      }
      // Reset voting data in Redis
      await this.redis.clearVotes(lobby.id.toString());
      console.log(`Voting data reset for lobby ${lobby.id}.`);
    }

    console.log(
      `Voting phase for round ${round.round_number} in session ${session.id} has concluded.`
    );
  }

  private async handleSessionEnd(session: Session) {
    console.log(`Session ${session.id} ended.`);

    // Notify via Pusher
    await this.pusher.trigger("sessions", "session-end", {
      sessionId: session.id,
      endTime: session.end_time,
    });

    // Redis cleanup: remove all keys related to the session and its lobbies
    try {
      console.log(`Cleaning up Redis data for session ${session.id}...`);
      await this.redis.flushAll();
    } catch (err) {
      console.error(
        `Failed to clean up Redis data for session ${session.id}:`,
        err
      );
    }
  }
}
