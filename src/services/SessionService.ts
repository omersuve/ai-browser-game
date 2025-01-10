import { Pool } from "pg";
import { Session, CreateSessionRequest, Round } from "../types";
import Pusher from "pusher";

export default class SessionService {
  private db: Pool;
  private pusher: Pusher;

  constructor(db: Pool, pusher: Pusher) {
    this.db = db;
    this.pusher = pusher;
  }

  /**
   * Creates a new session in the database.
   * @param sessionData - The session creation request payload.
   * @returns The created session with rounds.
   */
  async createSession(sessionData: CreateSessionRequest): Promise<Session> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");

      const sessionInsertQuery = `
        INSERT INTO sessions (name, entry_fee, total_rounds, max_total_players, start_time, end_time, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
        RETURNING *;
      `;

      const sessionResult = await client.query(sessionInsertQuery, [
        sessionData.name,
        sessionData.entry_fee,
        sessionData.total_rounds,
        sessionData.max_total_players,
        sessionData.start_time,
        sessionData.end_time,
      ]);

      const session = sessionResult.rows[0];

      const rounds: Round[] = [];
      const staticIntervals = 2 * 60 * 1000; // AI decision (1 min) + Voting (1 min)
      const waitingTime = 1 * 60 * 1000; // Waiting before the first round
      const totalDynamicTime =
        new Date(session.end_time).getTime() -
        new Date(session.start_time).getTime() -
        waitingTime -
        staticIntervals * session.total_rounds;

      const roundDuration = Math.floor(totalDynamicTime / session.total_rounds);

      for (let i = 0; i < session.total_rounds; i++) {
        const roundStartTime = new Date(
          new Date(session.start_time).getTime() + i * roundDuration
        );
        const roundEndTime = new Date(roundStartTime.getTime() + roundDuration);

        const roundInsertQuery = `
          INSERT INTO rounds (session_id, round_number, start_time, end_time, created_at)
          VALUES ($1, $2, $3, $4, NOW())
          RETURNING *;
        `;

        const roundResult = await client.query(roundInsertQuery, [
          session.id,
          i + 1,
          roundStartTime.toISOString(),
          roundEndTime.toISOString(),
        ]);

        rounds.push(roundResult.rows[0]);
      }

      await client.query("COMMIT");

      // Notify via Pusher
      await this.pusher.trigger("sessions", "session-created", {
        sessionId: session.id,
        name: session.name,
        startTime: session.start_time,
        endTime: session.end_time,
      });

      return { ...session, rounds };
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Error creating session:", error);
      throw new Error("Failed to create session.");
    } finally {
      client.release();
    }
  }

  /**
   * Retrieves a session by ID.
   * @param sessionId - The session ID.
   * @returns The session data with associated rounds and players.
   */
  async getSessionById(sessionId: number): Promise<Session | null> {
    const sessionQuery = `
      SELECT * FROM sessions WHERE id = $1;
    `;
    const sessionResult = await this.db.query(sessionQuery, [sessionId]);

    if (sessionResult.rows.length === 0) {
      return null;
    }

    const session = sessionResult.rows[0];

    const roundsQuery = `
      SELECT * FROM rounds WHERE session_id = $1 ORDER BY round_number ASC;
    `;
    const roundsResult = await this.db.query(roundsQuery, [sessionId]);

    const playersQuery = `
      SELECT * FROM players WHERE session_id = $1 ORDER BY joined_at ASC;
    `;
    const playersResult = await this.db.query(playersQuery, [sessionId]);

    return {
      ...session,
      rounds: roundsResult.rows,
      players: playersResult.rows,
    };
  }

  /**
   * Deletes a session by ID.
   * @param sessionId - The session ID.
   */
  async deleteSession(sessionId: number): Promise<void> {
    const deleteQuery = `
      DELETE FROM sessions WHERE id = $1;
    `;
    await this.db.query(deleteQuery, [sessionId]);
    console.log(`Session with ID ${sessionId} deleted.`);
  }

  /**
   * Retrieves all sessions.
   * @returns A list of all sessions.
   */
  async getAllSessions(): Promise<Session[]> {
    const sessionsQuery = `
      SELECT * FROM sessions ORDER BY start_time ASC;
    `;
    const result = await this.db.query(sessionsQuery);
    return result.rows;
  }
}
