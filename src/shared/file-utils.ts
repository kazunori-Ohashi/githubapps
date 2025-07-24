import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { GitHubInstallation, GuildMapping, OperationLog } from './types';

const DATA_PATH = process.env.DATA_PATH || './data';

export class FileUtils {
  static async ensureDirectoryExists(dirPath: string): Promise<void> {
    try {
      await fs.access(dirPath);
    } catch {
      await fs.mkdir(dirPath, { recursive: true });
    }
  }

  static async readYamlFile<T>(filePath: string): Promise<T | null> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return yaml.load(content) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  static async writeYamlFile<T>(filePath: string, data: T): Promise<void> {
    const dir = path.dirname(filePath);
    await this.ensureDirectoryExists(dir);
    
    const yamlContent = yaml.dump(data, {
      indent: 2,
      lineWidth: -1,
      noRefs: true
    });
    
    await fs.writeFile(filePath, yamlContent, 'utf-8');
  }

  static async appendLogFile(logPath: string, logEntry: string): Promise<void> {
    const dir = path.dirname(logPath);
    await this.ensureDirectoryExists(dir);
    
    const timestamp = new Date().toISOString();
    const logLine = `${timestamp} ${logEntry}\n`;
    
    await fs.appendFile(logPath, logLine, 'utf-8');
  }

  static async getInstallation(installationId: number): Promise<GitHubInstallation | null> {
    const filePath = path.join(DATA_PATH, 'installations', `${installationId}.yml`);
    return this.readYamlFile<GitHubInstallation>(filePath);
  }

  static async saveInstallation(installation: GitHubInstallation): Promise<void> {
    const filePath = path.join(DATA_PATH, 'installations', `${installation.installation_id}.yml`);
    await this.writeYamlFile(filePath, installation);
  }

  static async deleteInstallation(installationId: number): Promise<void> {
    const filePath = path.join(DATA_PATH, 'installations', `${installationId}.yml`);
    try {
      await fs.unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  static async getGuildMapping(guildId: string): Promise<GuildMapping | null> {
    const filePath = path.join(DATA_PATH, 'guild_mappings', `${guildId}.yml`);
    return this.readYamlFile<GuildMapping>(filePath);
  }

  static async saveGuildMapping(mapping: GuildMapping): Promise<void> {
    const filePath = path.join(DATA_PATH, 'guild_mappings', `${mapping.guild_id}.yml`);
    await this.writeYamlFile(filePath, mapping);
  }

  static async deleteGuildMapping(guildId: string): Promise<void> {
    const filePath = path.join(DATA_PATH, 'guild_mappings', `${guildId}.yml`);
    try {
      await fs.unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  static async logOperation(operation: OperationLog): Promise<void> {
    const date = new Date().toISOString().split('T')[0];
    const logPath = path.join(DATA_PATH, 'operation_logs', `${date}.log`);
    
    const logEntry = JSON.stringify(operation);
    await this.appendLogFile(logPath, logEntry);
  }

  static async findGuildsByInstallation(installationId: number): Promise<GuildMapping[]> {
    const guildsDir = path.join(DATA_PATH, 'guild_mappings');
    
    try {
      const files = await fs.readdir(guildsDir);
      const mappings: GuildMapping[] = [];
      
      for (const file of files) {
        if (!file.endsWith('.yml')) continue;
        
        const mapping = await this.readYamlFile<GuildMapping>(
          path.join(guildsDir, file)
        );
        
        if (mapping && mapping.installation_id === installationId) {
          mappings.push(mapping);
        }
      }
      
      return mappings;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }
}