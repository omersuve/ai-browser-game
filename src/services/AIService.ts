import ApiClient from "../utils/ApiClient";
import { AIResponse, RoundDecision } from "../types";

export default class AIService {
  private apiClient: ApiClient;

  constructor(baseUrl: string) {
    this.apiClient = new ApiClient(baseUrl);
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

      return response.data?.lobbies || [];
    } catch (error) {
      console.error("Error fetching AI decision:", error);
      throw error;
    }
  }
}
