export default class TimeUtils {
  /**
   * Sleeps for the specified duration.
   * @param ms - The duration to sleep (in milliseconds).
   */
  static async sleep(ms: number): Promise<void> {
    console.log(`Sleeping for ${ms / 1000} seconds...`);
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Sleeps until the specified timestamp.
   * @param timestamp - The future timestamp (in milliseconds since epoch).
   */
  static async sleepUntil(timestamp: number): Promise<void> {
    const now = Date.now();
    const delay = timestamp - now;

    if (delay > 0) {
      console.log(`Sleeping for ${delay / 1000} seconds...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    } else {
      console.warn("The timestamp is in the past; skipping sleep.");
    }
  }

  /**
   * Formats a duration in milliseconds into a human-readable string.
   * @param ms - The duration in milliseconds.
   * @returns A formatted string (e.g., "2h 3m 4s").
   */
  static formatDuration(ms: number): string {
    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor((ms / (1000 * 60)) % 60);
    const hours = Math.floor(ms / (1000 * 60 * 60));

    const parts = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (seconds > 0) parts.push(`${seconds}s`);

    return parts.join(" ") || "0s";
  }

  /**
   * Gets the current time as an ISO string.
   * @returns The current time in ISO format.
   */
  static getCurrentTimeISO(): string {
    return new Date().toISOString();
  }

  /**
   * Adds a specified number of milliseconds to a timestamp.
   * @param timestamp - The starting timestamp (in milliseconds).
   * @param ms - The number of milliseconds to add.
   * @returns The new timestamp (in milliseconds).
   */
  static addMilliseconds(timestamp: number, ms: number): number {
    return timestamp + ms;
  }

  /**
   * Checks whether the given timestamp is in the past.
   * @param timestamp - The timestamp to check (in milliseconds).
   * @returns True if the timestamp is in the past; false otherwise.
   */
  static isInPast(timestamp: number): boolean {
    return Date.now() > timestamp;
  }
}
