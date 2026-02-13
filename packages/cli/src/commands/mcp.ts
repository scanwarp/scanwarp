#!/usr/bin/env node

/**
 * Production MCP server command
 * Connects to a running ScanWarp server and exposes monitoring data to AI coding tools
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { ScanWarpAPI } from '../mcp/api.js';
import {
  getAppStatus,
  getIncidents,
  getIncidentDetail,
  getEvents,
  resolveIncident,
  getFixPrompt,
  getRecentTraces,
  getTraceDetail,
  getTraceForIncident,
} from '../mcp/tools.js';

interface McpOptions {
  server?: string;
  token?: string;
  project?: string;
}

export async function mcpCommand(options: McpOptions = {}) {
  const serverUrl = options.server || process.env.SCANWARP_SERVER_URL || 'http://localhost:3000';
  const apiToken = options.token || process.env.SCANWARP_API_TOKEN;
  const projectId = options.project || process.env.SCANWARP_PROJECT_ID;

  // Initialize API client
  const api = new ScanWarpAPI(serverUrl, apiToken);

  // Create MCP server
  const server = new Server(
    {
      name: 'scanwarp',
      version: '0.3.0',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    }
  );

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'get_app_status',
          description:
            'Get overall health status of your application. Shows monitor status, active incidents, and provider health. Returns a concise plain English summary.',
          inputSchema: {
            type: 'object',
            properties: {
              project_id: {
                type: 'string',
                description: 'Project ID to check status for',
              },
            },
            required: ['project_id'],
          },
        },
        {
          name: 'get_incidents',
          description:
            'List incidents with their diagnosis and fix suggestions. Can filter by status (open/resolved) and severity (critical/warning/info).',
          inputSchema: {
            type: 'object',
            properties: {
              project_id: {
                type: 'string',
                description: 'Project ID',
              },
              status: {
                type: 'string',
                description: 'Filter by status: open or resolved',
                enum: ['open', 'resolved'],
              },
              severity: {
                type: 'string',
                description: 'Filter by severity: critical, warning, or info',
                enum: ['critical', 'warning', 'info'],
              },
              limit: {
                type: 'number',
                description: 'Maximum number of incidents to return (default: 10)',
              },
            },
            required: ['project_id'],
          },
        },
        {
          name: 'get_incident_detail',
          description:
            'Get full details for a specific incident including root cause, timeline, correlated events, and the complete fix prompt ready to use.',
          inputSchema: {
            type: 'object',
            properties: {
              incident_id: {
                type: 'string',
                description: 'Incident ID',
              },
            },
            required: ['incident_id'],
          },
        },
        {
          name: 'get_events',
          description:
            'Get recent events with optional filters. Useful for understanding patterns and troubleshooting.',
          inputSchema: {
            type: 'object',
            properties: {
              project_id: {
                type: 'string',
                description: 'Project ID',
              },
              type: {
                type: 'string',
                description: 'Filter by event type (error, slow, down, up)',
              },
              source: {
                type: 'string',
                description:
                  'Filter by source (monitor, vercel, stripe, github, supabase, provider-status)',
              },
              severity: {
                type: 'string',
                description: 'Filter by severity (critical, high, medium, low)',
              },
              limit: {
                type: 'number',
                description: 'Maximum number of events to return (default: 20)',
              },
            },
            required: ['project_id'],
          },
        },
        {
          name: 'resolve_incident',
          description:
            'Mark an incident as resolved. This will trigger resolution notifications to configured channels.',
          inputSchema: {
            type: 'object',
            properties: {
              incident_id: {
                type: 'string',
                description: 'Incident ID to resolve',
              },
            },
            required: ['incident_id'],
          },
        },
        {
          name: 'get_fix_prompt',
          description:
            'Get JUST the fix prompt for an incident - the exact text that can be used in an AI coding tool to fix the issue.',
          inputSchema: {
            type: 'object',
            properties: {
              incident_id: {
                type: 'string',
                description: 'Incident ID',
              },
            },
            required: ['incident_id'],
          },
        },
        {
          name: 'get_recent_traces',
          description:
            'List recent request traces from OpenTelemetry instrumentation. Shows root spans with summary info (duration, span count, error status). Filter by status to find failing requests.',
          inputSchema: {
            type: 'object',
            properties: {
              project_id: {
                type: 'string',
                description: 'Project ID',
              },
              limit: {
                type: 'number',
                description: 'Maximum number of traces to return (default: 10)',
              },
              status: {
                type: 'string',
                description: 'Filter by trace status: "error" for traces with errors, "ok" for successful traces',
                enum: ['error', 'ok'],
              },
            },
            required: ['project_id'],
          },
        },
        {
          name: 'get_trace_detail',
          description:
            'Get the full request waterfall for a specific trace. Shows all spans as an indented tree with timing, status, and error details. Use this to understand exactly what happened during a request.',
          inputSchema: {
            type: 'object',
            properties: {
              trace_id: {
                type: 'string',
                description: 'Trace ID to inspect',
              },
            },
            required: ['trace_id'],
          },
        },
        {
          name: 'get_trace_for_incident',
          description:
            'Get the most relevant trace data for an incident, combined with the AI diagnosis and fix prompt. Shows the request waterfall alongside the root cause analysis.',
          inputSchema: {
            type: 'object',
            properties: {
              incident_id: {
                type: 'string',
                description: 'Incident ID',
              },
            },
            required: ['incident_id'],
          },
        },
      ],
    };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'get_app_status': {
          const projectId = (args as { project_id: string }).project_id;
          const result = await getAppStatus(api, projectId);
          return {
            content: [{ type: 'text', text: result }],
          };
        }

        case 'get_incidents': {
          const { project_id, status, severity, limit } = args as {
            project_id: string;
            status?: 'open' | 'resolved';
            severity?: 'critical' | 'warning' | 'info';
            limit?: number;
          };
          const result = await getIncidents(api, project_id, {
            status,
            severity,
            limit,
          });
          return {
            content: [{ type: 'text', text: result }],
          };
        }

        case 'get_incident_detail': {
          const { incident_id } = args as { incident_id: string };
          const result = await getIncidentDetail(api, incident_id);
          return {
            content: [{ type: 'text', text: result }],
          };
        }

        case 'get_events': {
          const { project_id, type, source, severity, limit } = args as {
            project_id: string;
            type?: string;
            source?: string;
            severity?: string;
            limit?: number;
          };
          const result = await getEvents(api, project_id, {
            type,
            source,
            severity,
            limit,
          });
          return {
            content: [{ type: 'text', text: result }],
          };
        }

        case 'resolve_incident': {
          const { incident_id } = args as { incident_id: string };
          const result = await resolveIncident(api, incident_id);
          return {
            content: [{ type: 'text', text: result }],
          };
        }

        case 'get_fix_prompt': {
          const { incident_id } = args as { incident_id: string };
          const result = await getFixPrompt(api, incident_id);
          return {
            content: [{ type: 'text', text: result }],
          };
        }

        case 'get_recent_traces': {
          const { project_id, limit, status } = args as {
            project_id: string;
            limit?: number;
            status?: 'error' | 'ok';
          };
          const result = await getRecentTraces(api, project_id, { limit, status });
          return {
            content: [{ type: 'text', text: result }],
          };
        }

        case 'get_trace_detail': {
          const { trace_id } = args as { trace_id: string };
          const result = await getTraceDetail(api, trace_id);
          return {
            content: [{ type: 'text', text: result }],
          };
        }

        case 'get_trace_for_incident': {
          const { incident_id } = args as { incident_id: string };
          const result = await getTraceForIncident(api, incident_id);
          return {
            content: [{ type: 'text', text: result }],
          };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error: ${errorMessage}` }],
        isError: true,
      };
    }
  });

  // List resources
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    if (!projectId) {
      return { resources: [] };
    }

    return {
      resources: [
        {
          uri: 'scanwarp://status',
          name: 'Application Status',
          description:
            'Current health status of your application including monitors, incidents, and provider status',
          mimeType: 'text/plain',
        },
        {
          uri: 'scanwarp://incidents',
          name: 'Active Incidents',
          description: 'List of currently active incidents requiring attention',
          mimeType: 'text/plain',
        },
      ],
    };
  });

  // Handle resource reads
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    if (!projectId) {
      return {
        contents: [
          {
            uri,
            mimeType: 'text/plain',
            text: 'Error: SCANWARP_PROJECT_ID not configured. Pass --project or set SCANWARP_PROJECT_ID env var.',
          },
        ],
      };
    }

    try {
      switch (uri) {
        case 'scanwarp://status': {
          const status = await getAppStatus(api, projectId);
          return {
            contents: [
              {
                uri,
                mimeType: 'text/plain',
                text: status,
              },
            ],
          };
        }

        case 'scanwarp://incidents': {
          const incidents = await getIncidents(api, projectId, {
            status: 'open',
          });
          return {
            contents: [
              {
                uri,
                mimeType: 'text/plain',
                text: incidents,
              },
            ],
          };
        }

        default:
          throw new Error(`Unknown resource: ${uri}`);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        contents: [
          {
            uri,
            mimeType: 'text/plain',
            text: `Error: ${errorMessage}`,
          },
        ],
      };
    }
  });

  // Start the server
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('ScanWarp MCP server running on stdio');
  console.error(`Connected to: ${serverUrl}`);
  if (projectId) {
    console.error(`Default project: ${projectId}`);
  }
}
