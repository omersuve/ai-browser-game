import ApiClient from "../utils/ApiClient";
import { AIResponse, RoundDecision } from "../types";
import Pusher from "pusher";

export default class AIService {
  private apiClient: ApiClient;
  private pusher: Pusher;

  constructor(baseUrl: string, pusher: Pusher) {
    this.apiClient = new ApiClient(baseUrl);
    this.pusher = pusher;
  }

  /**
   * Sends a request to the AI decision endpoint.
   * @param sessionId - The ID of the session.
   * @param lobbies - The list of lobbies with their forum messages.
   * @returns The AI's response for each lobby.
   */
  async getRoundDecision(
    decisionData: RoundDecision
  ): Promise<{ lobby_id: number; decision: AIResponse }[]> {
    try {
      const response = await this.apiClient.post<{
        lobbies: { lobby_id: number; decision: AIResponse }[];
      }>("/decision", {
        session_id: decisionData.sessionId,
        lobbies: decisionData.lobbies,
      });

      if (response.error) {
        throw new Error(`AI API error: ${response.error}`);
      }

      const decisions = response.data?.lobbies || [];

      // Notify each lobby of their AI decision
      for (const { lobby_id, decision } of decisions) {
        await this.pusher.trigger(
          `lobby-${lobby_id}`,
          "round-decision",
          decision
        );
      }

      return decisions;
    } catch (error) {
      console.error("Error fetching AI decision:", error);
      throw error;
    }
  }
}
