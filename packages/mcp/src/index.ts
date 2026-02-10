import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const server = new Server(
  {
    name: 'scanwarp-mcp',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'check_service_status',
        description: 'Check the status of a monitored service',
        inputSchema: {
          type: 'object',
          properties: {
            serviceName: {
              type: 'string',
              description: 'Name of the service to check',
            },
          },
          required: ['serviceName'],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === 'check_service_status') {
    const { serviceName } = request.params.arguments as { serviceName: string };

    return {
      content: [
        {
          type: 'text',
          text: `Status check for service: ${serviceName}`,
        },
      ],
    };
  }

  throw new Error(`Unknown tool: ${request.params.name}`);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('ScanWarp MCP server running on stdio');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
