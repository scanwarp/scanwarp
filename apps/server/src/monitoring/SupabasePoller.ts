import type { Database } from '../db/index.js';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export class SupabasePoller {
  private db: Database;
  private supabase: SupabaseClient;
  private projectRef: string;
  private intervalId?: NodeJS.Timeout;
  private isRunning = false;

  constructor(db: Database, projectRef: string, serviceKey: string) {
    this.db = db;
    this.projectRef = projectRef;

    // Create Supabase client
    this.supabase = createClient(
      `https://${projectRef}.supabase.co`,
      serviceKey
    );
  }

  async start() {
    if (this.isRunning) {
      console.log('SupabasePoller already running');
      return;
    }

    this.isRunning = true;
    console.log('Starting SupabasePoller...');

    // Run checks immediately on start
    await this.runChecks();

    // Then run every 60 seconds
    this.intervalId = setInterval(() => {
      this.runChecks().catch((err) => {
        console.error('Error in Supabase checks:', err);
      });
    }, 60_000);
  }

  async stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
    this.isRunning = false;
    console.log('SupabasePoller stopped');
  }

  private async runChecks() {
    try {
      await this.checkDatabaseHealth();
      await this.checkConnectionPool();
    } catch (error) {
      console.error('Failed to run Supabase checks:', error);
    }
  }

  private async checkDatabaseHealth() {
    try {
      // Simple health check - try to query the database
      const { error } = await this.supabase.from('_supabase_migrations').select('version').limit(1);

      if (error) {
        // If migrations table doesn't exist, try a simple RPC call
        const { error: rpcError } = await this.supabase.rpc('version');

        if (rpcError) {
          await this.createEvent({
            type: 'down',
            message: `Supabase database is unhealthy: ${rpcError.message}`,
            severity: 'critical',
            raw_data: {
              error: rpcError,
              check: 'database_health',
            },
          });
        }
      }
    } catch (error) {
      await this.createEvent({
        type: 'error',
        message: `Failed to check Supabase database health: ${error instanceof Error ? error.message : 'Unknown error'}`,
        severity: 'high',
        raw_data: {
          error: error instanceof Error ? error.message : String(error),
          check: 'database_health',
        },
      });
    }
  }

  private async checkConnectionPool() {
    try {
      // Query pg_stat_activity to get connection info
      const { data, error } = await this.supabase.rpc('pg_stat_activity');

      if (error) {
        // If we can't get stats, log it but don't create an event
        console.warn('Could not fetch connection pool stats:', error.message);
        return;
      }

      if (data && Array.isArray(data)) {
        const activeConnections = data.length;
        // Supabase free tier has ~60 connections, paid tiers vary
        // We'll use a conservative estimate of 100 as the pool size
        const maxConnections = parseInt(process.env.SUPABASE_MAX_CONNECTIONS || '100');
        const utilizationPercent = (activeConnections / maxConnections) * 100;

        if (utilizationPercent > 80) {
          await this.createEvent({
            type: 'error',
            message: `Supabase connection pool is ${utilizationPercent.toFixed(1)}% full (${activeConnections}/${maxConnections} connections)`,
            severity: utilizationPercent > 95 ? 'critical' : 'high',
            raw_data: {
              active_connections: activeConnections,
              max_connections: maxConnections,
              utilization_percent: utilizationPercent,
              check: 'connection_pool',
            },
          });
        }
      }
    } catch (error) {
      console.warn('Failed to check connection pool:', error);
    }
  }

  private async createEvent(event: {
    type: 'error' | 'down' | 'up';
    message: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    raw_data: Record<string, unknown>;
  }) {
    const projectName = `supabase-${this.projectRef}`;
    const { id: projectId } = await this.db.getOrCreateProject(projectName);

    await this.db.createEvent({
      project_id: projectId,
      type: event.type,
      source: 'supabase',
      message: event.message,
      raw_data: event.raw_data,
      severity: event.severity,
    });

    console.log(`Supabase event created: ${event.message}`);
  }
}
