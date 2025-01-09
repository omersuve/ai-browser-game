export const getAllSessions = `
  SELECT * FROM sessions ORDER BY start_time ASC;
`;

export const getActiveSessions = `
  SELECT * FROM sessions WHERE end_time > NOW() AND completed = FALSE;
`;

export const markSessionCompleted = `
  UPDATE sessions SET completed = TRUE WHERE id = $1;
`;
