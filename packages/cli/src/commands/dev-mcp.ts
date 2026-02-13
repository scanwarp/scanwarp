import { startDevMcpServer } from '../dev/mcp-dev.js';

interface DevMcpOptions {
  port?: number;
}

export async function devMcpCommand(options: DevMcpOptions = {}) {
  const port = options.port || 3456;
  await startDevMcpServer(port);
}
