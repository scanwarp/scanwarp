import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import inquirer from 'inquirer';
import type { DetectedProject } from '../detector.js';

export async function setupBrowserMonitoring(
  detected: DetectedProject,
  serverUrl: string,
  projectId: string
): Promise<void> {
  const { addBrowserMonitoring } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'addBrowserMonitoring',
      message: 'Add browser error monitoring to track frontend errors in production?',
      default: true,
    },
  ]);

  if (!addBrowserMonitoring) {
    console.log(chalk.gray('  Skipped\n'));
    return;
  }

  const cwd = process.cwd();

  // Detect where to inject the script tag based on framework
  let injectionTarget: string | null = null;
  let injectionInstructions: string = '';

  if (detected.framework === 'Next.js') {
    // Check for App Router layout
    const appLayoutPath = path.join(cwd, 'app', 'layout.tsx');
    const appLayoutJsPath = path.join(cwd, 'app', 'layout.js');
    const pagesAppPath = path.join(cwd, 'pages', '_app.tsx');
    const pagesAppJsPath = path.join(cwd, 'pages', '_app.js');

    if (fs.existsSync(appLayoutPath)) {
      injectionTarget = appLayoutPath;
    } else if (fs.existsSync(appLayoutJsPath)) {
      injectionTarget = appLayoutJsPath;
    } else if (fs.existsSync(pagesAppPath)) {
      injectionTarget = pagesAppPath;
    } else if (fs.existsSync(pagesAppJsPath)) {
      injectionTarget = pagesAppJsPath;
    }

    if (injectionTarget) {
      await injectNextJsScript(injectionTarget, serverUrl, projectId);
      console.log(chalk.green(`✓ Added browser monitoring to ${path.relative(cwd, injectionTarget)}`));
    } else {
      injectionInstructions = getNextJsManualInstructions(serverUrl, projectId);
    }
  } else if (detected.framework === 'React' || detected.framework === 'Vite') {
    // Look for public/index.html or index.html
    const publicIndexPath = path.join(cwd, 'public', 'index.html');
    const rootIndexPath = path.join(cwd, 'index.html');

    if (fs.existsSync(publicIndexPath)) {
      injectionTarget = publicIndexPath;
    } else if (fs.existsSync(rootIndexPath)) {
      injectionTarget = rootIndexPath;
    }

    if (injectionTarget) {
      await injectHtmlScript(injectionTarget, serverUrl, projectId);
      console.log(chalk.green(`✓ Added browser monitoring to ${path.relative(cwd, injectionTarget)}`));
    } else {
      injectionInstructions = getHtmlManualInstructions(serverUrl, projectId);
    }
  } else {
    // Unknown framework - provide manual instructions
    injectionInstructions = getHtmlManualInstructions(serverUrl, projectId);
  }

  if (injectionInstructions) {
    console.log(chalk.yellow('\n⚠ Could not automatically add browser monitoring'));
    console.log(chalk.bold('\n  Manual Setup:\n'));
    console.log(injectionInstructions);
  }

  console.log(chalk.gray('\n  Browser monitoring will:\n'));
  console.log(chalk.gray('    • Capture console errors and unhandled exceptions'));
  console.log(chalk.gray('    • Detect blank screens and React hydration failures'));
  console.log(chalk.gray('    • Track network errors (failed API calls)'));
  console.log(chalk.gray('    • Send errors to ScanWarp for AI diagnosis\n'));
}

async function injectNextJsScript(
  filePath: string,
  serverUrl: string,
  projectId: string
): Promise<void> {
  const content = fs.readFileSync(filePath, 'utf-8');

  // Check if already injected
  if (content.includes('scanwarp-browser')) {
    console.log(chalk.yellow('  Browser monitoring already added, skipping'));
    return;
  }

  // Use environment variable for project ID (more secure than hardcoding)
  const scriptTag = `
        <script
          src="${serverUrl}/browser.js"
          data-server-url="${serverUrl}"
          data-project-id={process.env.NEXT_PUBLIC_SCANWARP_PROJECT_ID}
        />`;

  // Find the <head> or <body> tag and inject before </head> or after <body>
  let modifiedContent: string;

  if (content.includes('</head>')) {
    modifiedContent = content.replace('</head>', `${scriptTag}\n      </head>`);
  } else if (content.includes('<body')) {
    modifiedContent = content.replace(/<body([^>]*)>/, `<body$1>${scriptTag}`);
  } else {
    throw new Error('Could not find <head> or <body> tag in layout file');
  }

  fs.writeFileSync(filePath, modifiedContent);

  // Add env var to .env.local
  const envPath = path.join(path.dirname(filePath), '..', '.env.local');
  const envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : '';

  if (!envContent.includes('NEXT_PUBLIC_SCANWARP_PROJECT_ID')) {
    fs.appendFileSync(
      envPath,
      `\n# ScanWarp Browser Monitoring\nNEXT_PUBLIC_SCANWARP_PROJECT_ID=${projectId}\n`
    );
    console.log(chalk.green('  ✓ Added NEXT_PUBLIC_SCANWARP_PROJECT_ID to .env.local'));
  }
}

async function injectHtmlScript(
  filePath: string,
  serverUrl: string,
  projectId: string
): Promise<void> {
  const content = fs.readFileSync(filePath, 'utf-8');

  // Check if already injected
  if (content.includes('scanwarp-browser') || content.includes('data-project-id')) {
    console.log(chalk.yellow('  Browser monitoring already added, skipping'));
    return;
  }

  const scriptTag = `    <script
      src="${serverUrl}/browser.js"
      data-server-url="${serverUrl}"
      data-project-id="${projectId}"
    ></script>`;

  // Inject before </head> if exists, otherwise after <body>
  let modifiedContent: string;

  if (content.includes('</head>')) {
    modifiedContent = content.replace('</head>', `${scriptTag}\n  </head>`);
  } else if (content.includes('<body')) {
    modifiedContent = content.replace(/<body([^>]*)>/, `<body$1>\n${scriptTag}`);
  } else {
    throw new Error('Could not find <head> or <body> tag in HTML file');
  }

  fs.writeFileSync(filePath, modifiedContent);
}

function getNextJsManualInstructions(serverUrl: string, projectId: string): string {
  return `${chalk.gray('  Add this to your app/layout.tsx or pages/_app.tsx:\n')}
${chalk.cyan(`  <script
    src="${serverUrl}/browser.js"
    data-server-url="${serverUrl}"
    data-project-id={process.env.NEXT_PUBLIC_SCANWARP_PROJECT_ID}
  />`)}

${chalk.gray('  And add to .env.local:\n')}
${chalk.cyan(`  NEXT_PUBLIC_SCANWARP_PROJECT_ID=${projectId}`)}
`;
}

function getHtmlManualInstructions(serverUrl: string, projectId: string): string {
  return `${chalk.gray('  Add this script tag to your HTML <head>:\n')}
${chalk.cyan(`  <script
    src="${serverUrl}/browser.js"
    data-server-url="${serverUrl}"
    data-project-id="${projectId}"
  ></script>`)}
`;
}
