import fs from 'fs';
import path from 'path';

export interface DetectedProject {
  framework?: string;
  hosting?: string;
  services: string[];
  hasPackageJson: boolean;
  projectName?: string;
}

export function detectProject(cwd: string = process.cwd()): DetectedProject {
  const result: DetectedProject = {
    services: [],
    hasPackageJson: false,
  };

  // Check for package.json
  const packageJsonPath = path.join(cwd, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    result.hasPackageJson = true;

    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      result.projectName = packageJson.name;

      const allDeps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
      };

      // Detect framework
      if (allDeps['next']) {
        result.framework = 'Next.js';
      } else if (allDeps['@remix-run/react'] || allDeps['@remix-run/node']) {
        result.framework = 'Remix';
      } else if (allDeps['astro']) {
        result.framework = 'Astro';
      } else if (allDeps['@sveltejs/kit']) {
        result.framework = 'SvelteKit';
      } else if (allDeps['nuxt']) {
        result.framework = 'Nuxt';
      } else if (allDeps['react']) {
        result.framework = 'React';
      } else if (allDeps['vue']) {
        result.framework = 'Vue';
      }

      // Detect services
      if (allDeps['@supabase/supabase-js']) {
        result.services.push('Supabase');
      }
      if (allDeps['stripe']) {
        result.services.push('Stripe');
      }
      if (allDeps['@sendgrid/mail']) {
        result.services.push('SendGrid');
      }
      if (allDeps['resend']) {
        result.services.push('Resend');
      }
      if (allDeps['@vercel/postgres'] || allDeps['@vercel/kv']) {
        result.services.push('Vercel Storage');
      }
      if (allDeps['prisma'] || allDeps['@prisma/client']) {
        result.services.push('Prisma');
      }
    } catch (error) {
      console.warn('Failed to parse package.json:', error);
    }
  }

  // Detect hosting
  if (
    fs.existsSync(path.join(cwd, 'vercel.json')) ||
    fs.existsSync(path.join(cwd, '.vercel'))
  ) {
    result.hosting = 'Vercel';
  } else if (fs.existsSync(path.join(cwd, 'netlify.toml'))) {
    result.hosting = 'Netlify';
  } else if (fs.existsSync(path.join(cwd, 'railway.toml'))) {
    result.hosting = 'Railway';
  } else if (fs.existsSync(path.join(cwd, 'fly.toml'))) {
    result.hosting = 'Fly.io';
  } else if (fs.existsSync(path.join(cwd, 'render.yaml'))) {
    result.hosting = 'Render';
  }

  return result;
}

export function generateDefaultUrl(detected: DetectedProject): string {
  if (!detected.projectName) {
    return 'https://';
  }

  const cleanName = detected.projectName.replace(/[^a-z0-9-]/g, '-');

  if (detected.hosting === 'Vercel') {
    return `https://${cleanName}.vercel.app`;
  } else if (detected.hosting === 'Netlify') {
    return `https://${cleanName}.netlify.app`;
  } else if (detected.hosting === 'Fly.io') {
    return `https://${cleanName}.fly.dev`;
  } else if (detected.hosting === 'Railway') {
    return `https://${cleanName}.up.railway.app`;
  } else if (detected.hosting === 'Render') {
    return `https://${cleanName}.onrender.com`;
  }

  return 'https://';
}
