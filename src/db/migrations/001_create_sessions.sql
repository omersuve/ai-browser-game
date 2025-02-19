CREATE TABLE IF NOT EXISTS sessions (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  entry_fee BIGINT NOT NULL DEFAULT 10000,
  max_total_players INT NOT NULL DEFAULT 100,
  total_rounds INT NOT NULL DEFAULT 10,
  start_time TIMESTAMP NOT NULL,
  end_time TIMESTAMP NOT NULL,
  completed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE sessions
ADD COLUMN IF NOT EXISTS completed BOOLEAN DEFAULT FALSE;
