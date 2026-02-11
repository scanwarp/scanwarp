-- ScanWarp Database Schema

-- Projects (grouping monitors)
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Monitors table
CREATE TABLE IF NOT EXISTS monitors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  check_interval_seconds INTEGER NOT NULL DEFAULT 60,
  last_checked_at TIMESTAMP,
  status VARCHAR(50) DEFAULT 'unknown',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_monitors_project_id ON monitors(project_id);
CREATE INDEX idx_monitors_last_checked ON monitors(last_checked_at);

-- Events table
CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  monitor_id UUID REFERENCES monitors(id) ON DELETE SET NULL,
  type VARCHAR(50) NOT NULL,
  source VARCHAR(50) NOT NULL DEFAULT 'monitor',
  message TEXT NOT NULL,
  raw_data JSONB,
  severity VARCHAR(20) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_events_project_id ON events(project_id);
CREATE INDEX idx_events_monitor_id ON events(monitor_id);
CREATE INDEX idx_events_type ON events(type);
CREATE INDEX idx_events_source ON events(source);
CREATE INDEX idx_events_created_at ON events(created_at);

-- Event statistics for anomaly detection
CREATE TABLE IF NOT EXISTS event_stats (
  monitor_id UUID PRIMARY KEY REFERENCES monitors(id) ON DELETE CASCADE,
  avg_response_time NUMERIC,
  total_checks INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0,
  last_error_at TIMESTAMP,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Incidents table for AI diagnosis
CREATE TABLE IF NOT EXISTS incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  events JSONB NOT NULL,
  correlation_group VARCHAR(255),
  status VARCHAR(50) NOT NULL DEFAULT 'open',
  diagnosis_text TEXT,
  diagnosis_fix TEXT,
  severity VARCHAR(20) NOT NULL,
  fix_prompt TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  resolved_at TIMESTAMP
);

CREATE INDEX idx_incidents_project_id ON incidents(project_id);
CREATE INDEX idx_incidents_correlation_group ON incidents(correlation_group);
CREATE INDEX idx_incidents_status ON incidents(status);
CREATE INDEX idx_incidents_created_at ON incidents(created_at);

-- Provider status table
CREATE TABLE IF NOT EXISTS provider_status (
  provider VARCHAR(100) PRIMARY KEY,
  status VARCHAR(50) NOT NULL,
  last_checked_at TIMESTAMP DEFAULT NOW(),
  details TEXT
);

CREATE INDEX idx_provider_status_last_checked ON provider_status(last_checked_at);

-- Notification channels table
CREATE TABLE IF NOT EXISTS notification_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  webhook_url TEXT NOT NULL,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_notification_channels_project_id ON notification_channels(project_id);
CREATE INDEX idx_notification_channels_enabled ON notification_channels(enabled);

-- Notification log for rate limiting
CREATE TABLE IF NOT EXISTS notification_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID REFERENCES notification_channels(id) ON DELETE CASCADE,
  incident_id UUID REFERENCES incidents(id) ON DELETE CASCADE,
  sent_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_notification_log_channel_id ON notification_log(channel_id);
CREATE INDEX idx_notification_log_sent_at ON notification_log(sent_at);

-- Waitlist entries
CREATE TABLE IF NOT EXISTS waitlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_waitlist_created_at ON waitlist(created_at);
CREATE INDEX idx_waitlist_email ON waitlist(email);

-- Legacy webhook events (keeping for compatibility)
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
