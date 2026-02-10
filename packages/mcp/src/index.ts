#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { ScanWarpAPI } from './api.js';
import {
  getAppStatus,
  getIncidents,
  getIncidentDetail,
  getEvents,
  resolveIncident,
  getFixPrompt,
} from './tools.js';

// Parse command line arguments
function parseArgs(): { serverUrl: string; apiToken?: string; projectId?: string } {
  const args = process.argv.slice(2);
  let serverUrl =
    process.env.SCANWARP_SERVER_URL || 'http://localhost:3000';
  let apiToken = process.env.SCANWARP_API_TOKEN;
  let projectId = process.env.SCANWARP_PROJECT_ID;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--server' && args[i + 1]) {
      serverUrl = args[i + 1];
      i++;
    } else if (args[i] === '--token' && args[i + 1]) {
      apiToken = args[i + 1];
      i++;
    } else if (args[i] === '--project' && args[i + 1]) {
      projectId = args[i + 1];
      i++;
    }
  }

  return { serverUrl, apiToken, projectId };
}

const config = parseArgs();

if (!config.serverUrl) {
  console.error(
    '❌ Error: SCANWARP_SERVER_URL is not configured. Pass --server or set SCANWARP_SERVER_URL env var.'
  );
  process.exit(1);
}

// Initialize API client
const api = new ScanWarpAPI(config.serverUrl, config.apiToken);

// Create MCP server
const server = new Server(
  {
    name: 'scanwarp',
    version: '0.1.0',
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
  if (!config.projectId) {
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

  if (!config.projectId) {
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
        const status = await getAppStatus(api, config.projectId);
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
        const incidents = await getIncidents(api, config.projectId, {
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
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('ScanWarp MCP server running on stdio');
  console.error(`Connected to: ${config.serverUrl}`);
  if (config.projectId) {
    console.error(`Default project: ${config.projectId}`);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
