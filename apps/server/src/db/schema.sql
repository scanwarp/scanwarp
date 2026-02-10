-- ScanWarp Database Schema

CREATE TABLE IF NOT EXISTS webhook_events (
  id SERIAL PRIMARY KEY,
  event VARCHAR(255) NOT NULL,
  service VARCHAR(255) NOT NULL,
  data JSONB NOT NULL,
  timestamp TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_webhook_events_service ON webhook_events(service);
CREATE INDEX idx_webhook_events_timestamp ON webhook_events(timestamp);

CREATE TABLE IF NOT EXISTS monitoring_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_name VARCHAR(255) NOT NULL UNIQUE,
  endpoint TEXT NOT NULL,
  interval INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS monitoring_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id UUID REFERENCES monitoring_configs(id) ON DELETE CASCADE,
  status VARCHAR(50) NOT NULL,
  response_time INTEGER,
  status_code INTEGER,
  error_message TEXT,
  timestamp TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_monitoring_events_config_id ON monitoring_events(config_id);
CREATE INDEX idx_monitoring_events_timestamp ON monitoring_events(timestamp);
