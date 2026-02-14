import fs from 'fs';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import inquirer from 'inquirer';

export async function setupMCP(serverUrl: string) {
  const homeDir = os.homedir();

  // Detect operating system and set config paths
  const platform = os.platform();
  let cursorConfigPath: string;
  let claudeConfigPath: string;
  let claudeCodeConfigPath: string;

  if (platform === 'darwin') {
    // macOS
    cursorConfigPath = path.join(homeDir, '.cursor', 'mcp.json');
    claudeConfigPath = path.join(homeDir, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
    claudeCodeConfigPath = path.join(homeDir, '.config', 'claude-code', 'mcp.json');
  } else if (platform === 'win32') {
    // Windows
    cursorConfigPath = path.join(homeDir, '.cursor', 'mcp.json');
    claudeConfigPath = path.join(homeDir, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json');
    claudeCodeConfigPath = path.join(homeDir, '.config', 'claude-code', 'mcp.json');
  } else {
    // Linux
    cursorConfigPath = path.join(homeDir, '.cursor', 'mcp.json');
    claudeConfigPath = path.join(homeDir, '.config', 'Claude', 'claude_desktop_config.json');
    claudeCodeConfigPath = path.join(homeDir, '.config', 'claude-code', 'mcp.json');
  }

  let configPath: string | null = null;
  let toolName = '';

  // Detect which config exists (or create default)
  if (fs.existsSync(cursorConfigPath)) {
    configPath = cursorConfigPath;
    toolName = 'Cursor';
    console.log(chalk.green('✓ Detected Cursor'));
  } else if (fs.existsSync(claudeCodeConfigPath)) {
    configPath = claudeCodeConfigPath;
    toolName = 'Claude Code';
    console.log(chalk.green('✓ Detected Claude Code'));
  } else if (fs.existsSync(claudeConfigPath)) {
    configPath = claudeConfigPath;
    toolName = 'Claude Desktop';
    console.log(chalk.green('✓ Detected Claude Desktop'));
  }

  if (!configPath) {
    // No config found - try to create one for Claude Code (most common for CLI users)
    configPath = claudeCodeConfigPath;
    toolName = 'Claude Code';
    console.log(chalk.yellow('⚠ No MCP config found, creating default for Claude Code'));

    // Ensure directory exists
    const configDir = path.dirname(configPath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
  }

  const { addMcp } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'addMcp',
      message: `Add ScanWarp MCP server to ${toolName}?`,
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

    // Use npx to run the published package - works anywhere
    (config.mcpServers as Record<string, unknown>).scanwarp = {
      command: 'npx',
      args: ['-y', 'scanwarp', 'mcp', '--server', serverUrl],
    };

    // Write config
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    console.log(chalk.green(`✓ MCP server added to ${toolName} configuration`));
    console.log(chalk.gray(`  Config: ${configPath}\n`));
    console.log(chalk.yellow(`  Restart ${toolName} to load the MCP server\n`));
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
  console.log(chalk.cyan('        "command": "npx",'));
  console.log(chalk.cyan(`        "args": ["-y", "scanwarp", "mcp", "--server", "${serverUrl}"]`));
  console.log(chalk.cyan('      }'));
  console.log(chalk.cyan('    }'));
  console.log(chalk.cyan('  }\n'));
  console.log(chalk.gray('  Config file locations:'));
  console.log(chalk.gray('    • Cursor: ~/.cursor/mcp.json'));
  console.log(chalk.gray('    • Claude Code: ~/.config/claude-code/mcp.json'));
  console.log(chalk.gray('    • Claude Desktop (macOS): ~/Library/Application Support/Claude/claude_desktop_config.json\n'));
}
