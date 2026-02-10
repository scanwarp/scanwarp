import fs from 'fs';
import path from 'path';
import os from 'os';

interface Config {
  serverUrl?: string;
  projectId?: string;
  apiToken?: string;
}

const CONFIG_DIR = path.join(os.homedir(), '.scanwarp');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export class ConfigManager {
  private config: Config = {};

  constructor() {
    this.load();
  }

  private ensureConfigDir() {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
  }

  load() {
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
        this.config = JSON.parse(content);
      }
    } catch (error) {
      console.warn('Failed to load config:', error);
      this.config = {};
    }
  }

  save() {
    try {
      this.ensureConfigDir();
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2));
    } catch (error) {
      console.error('Failed to save config:', error);
    }
  }

  get(key: keyof Config): string | undefined {
    return this.config[key];
  }

  set(key: keyof Config, value: string) {
    this.config[key] = value;
    this.save();
  }

  getAll(): Config {
    return { ...this.config };
  }

  clear() {
    this.config = {};
    this.save();
  }

  getServerUrl(): string {
    return this.config.serverUrl || 'http://localhost:3000';
  }

  setServerUrl(url: string) {
    this.set('serverUrl', url);
  }

  getProjectId(): string | undefined {
    return this.config.projectId;
  }

  setProjectId(id: string) {
    this.set('projectId', id);
  }

  getApiToken(): string | undefined {
    return this.config.apiToken;
  }

  setApiToken(token: string) {
    this.set('apiToken', token);
  }
}

export const config = new ConfigManager();
