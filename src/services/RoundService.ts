import { Pool } from "pg";
import { Round } from "../types";

export default class RoundService {
  private db: Pool;

  constructor(db: Pool) {
    this.db = db;
  }

  /**
   * Creates rounds for a given session.
   * @param sessionId - The ID of the session for which to create rounds.
   * @param totalRounds - The total number of rounds to create.
   * @param startTime - The start time of the first round.
   * @param endTime - The end time of the session.
   */
  async createRounds(
    sessionId: number,
    totalRounds: number,
    startTime: string,
    endTime: string
  ): Promise<Round[]> {
    const roundDuration =
      (new Date(endTime).getTime() - new Date(startTime).getTime()) /
      totalRounds;

    const rounds: Round[] = [];
    for (let i = 0; i < totalRounds; i++) {
      const roundStartTime = new Date(
        new Date(startTime).getTime() + i * roundDuration
      ).toISOString();
      const roundEndTime = new Date(
        new Date(startTime).getTime() + (i + 1) * roundDuration
      ).toISOString();

      const result = await this.db.query<Round>(
        `INSERT INTO rounds (session_id, round_number, start_time, end_time)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [sessionId, i + 1, roundStartTime, roundEndTime]
      );

      rounds.push(result.rows[0]);
    }

    console.log(`Created ${rounds.length} rounds for session ID ${sessionId}.`);
    return rounds;
  }

  /**
   * Retrieves all rounds for a given session.
   * @param sessionId - The session ID.
   * @returns The rounds for the session.
   */
  async getRoundsBySession(sessionId: number): Promise<Round[]> {
    const result = await this.db.query<Round>(
      `SELECT * FROM rounds WHERE session_id = $1 ORDER BY round_number ASC`,
      [sessionId]
    );
    return result.rows;
  }

  /**
   * Updates the AI decision for a specific round.
   * @param roundId - The ID of the round.
   * @param aiDecision - The AI's decision for the round.
   */
  async updateAIDecision(roundId: number, aiDecision: string): Promise<void> {
    await this.db.query(`UPDATE rounds SET ai_decision = $1 WHERE id = $2`, [
      aiDecision,
      roundId,
    ]);
    console.log(
      `Updated AI decision for round ID ${roundId} to ${aiDecision}.`
    );
  }

  /**
   * Retrieves a specific round by its ID.
   * @param roundId - The round ID.
   * @returns The round data, or null if not found.
   */
  async getRoundById(roundId: number): Promise<Round | null> {
    const result = await this.db.query<Round>(
      `SELECT * FROM rounds WHERE id = $1`,
      [roundId]
    );
    return result.rows[0] || null;
  }

  /**
   * Deletes all rounds for a specific session.
   * @param sessionId - The session ID.
   */
  async deleteRoundsBySession(sessionId: number): Promise<void> {
    await this.db.query(`DELETE FROM rounds WHERE session_id = $1`, [
      sessionId,
    ]);
    console.log(`Deleted all rounds for session ID ${sessionId}.`);
  }
}
