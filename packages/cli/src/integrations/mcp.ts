import fs from 'fs';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import inquirer from 'inquirer';

export async function setupMCP(serverUrl: string) {
  const homeDir = os.homedir();
  const cursorConfigPath = path.join(homeDir, '.cursor', 'mcp.json');
  const claudeConfigPath = path.join(homeDir, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');

  let configPath: string | null = null;

  // Detect which config exists
  if (fs.existsSync(cursorConfigPath)) {
    configPath = cursorConfigPath;
    console.log(chalk.green('✓ Detected Cursor'));
  } else if (fs.existsSync(claudeConfigPath)) {
    configPath = claudeConfigPath;
    console.log(chalk.green('✓ Detected Claude Desktop'));
  }

  if (!configPath) {
    console.log(chalk.yellow('⚠ MCP config file not found'));
    printManualInstructions(serverUrl);
    return;
  }

  const { addMcp } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'addMcp',
      message: 'Add ScanWarp MCP server to your configuration?',
      default: true,
    },
  ]);

  if (!addMcp) {
    console.log(chalk.gray('  Skipped\n'));
    return;
  }

  try {
    // Read existing config
    let config: Record<string, unknown> = {};
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8');
      config = JSON.parse(content);
    }

    // Add ScanWarp MCP server
    if (!config.mcpServers) {
      config.mcpServers = {};
    }

    (config.mcpServers as Record<string, unknown>).scanwarp = {
      command: 'node',
      args: [path.resolve(process.cwd(), 'packages/mcp/dist/index.js')],
      env: {
        SCANWARP_SERVER_URL: serverUrl,
      },
    };

    // Write config
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    console.log(chalk.green('✓ MCP server added to configuration'));
    console.log(chalk.gray(`  Config: ${configPath}\n`));
    console.log(chalk.yellow('  Restart your editor to load the MCP server\n'));
  } catch (error) {
    console.log(chalk.red('✗ Failed to update MCP config'));
    console.log(chalk.gray(`  ${error instanceof Error ? error.message : 'Unknown error'}\n`));
    printManualInstructions(serverUrl);
  }
}

function printManualInstructions(serverUrl: string) {
  console.log(chalk.bold('\n  Manual MCP Setup:\n'));
  console.log(chalk.gray('  Add this to your MCP config file:\n'));
  console.log(chalk.cyan('  {'));
  console.log(chalk.cyan('    "mcpServers": {'));
  console.log(chalk.cyan('      "scanwarp": {'));
  console.log(chalk.cyan('        "command": "node",'));
  console.log(chalk.cyan('        "args": ["path/to/packages/mcp/dist/index.js"],'));
  console.log(chalk.cyan('        "env": {'));
  console.log(chalk.cyan(`          "SCANWARP_SERVER_URL": "${serverUrl}"`));
  console.log(chalk.cyan('        }'));
  console.log(chalk.cyan('      }'));
  console.log(chalk.cyan('    }'));
  console.log(chalk.cyan('  }\n'));
}
