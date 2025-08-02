import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import jwt from 'jsonwebtoken';
import { Logger } from '../../shared/logger';
import { ErrorHandler, ValidationError, ExternalServiceError } from '../../shared/error-handler';

export interface GuildMapping {
  tenant_id: string;
  installation_id: string;
  default_repo: string;
  channel_overrides: Record<string, any>;
  updated_at: string;
}

export interface Installation {
  installation_id: string;
  app_id: string;
  account_login: string;
  account_type: 'User' | 'Organization';
  selected_repos: string[];
  updated_at: string;
}

export class ConfigService {
  private readonly guildMappingsDir = path.join(process.cwd(), 'data', 'guild_mappings');
  private readonly installationsDir = path.join(process.cwd(), 'data', 'installations');

  constructor() {
    this.ensureDirectories();
  }

  private ensureDirectories(): void {
    if (!fs.existsSync(this.guildMappingsDir)) {
      fs.mkdirSync(this.guildMappingsDir, { recursive: true });
    }
    if (!fs.existsSync(this.installationsDir)) {
      fs.mkdirSync(this.installationsDir, { recursive: true });
    }
  }

  // 入力値の形式検証
  validateRepoFormat(repo: string): void {
    const repoPattern = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;
    if (!repoPattern.test(repo)) {
      throw new ValidationError('repo 形式エラー：owner/repo 形式で指定してください。');
    }
  }

  validateInstallationId(installationId: string): void {
    if (!/^\d+$/.test(installationId)) {
      throw new ValidationError('installation_id は数値で指定してください。');
    }
  }

  // GitHub API認証とトークン発行
  async getInstallationToken(installationId: string): Promise<string> {
    try {
      const appId = process.env.GITHUB_APP_ID;
      const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;

      if (!appId || !privateKey) {
        throw new ExternalServiceError('GitHub', 'GitHub App設定が不完全です。');
      }

      // JWT生成
      const payload = {
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + (10 * 60), // 10分間有効
        iss: appId
      };

      const token = jwt.sign(payload, privateKey, { algorithm: 'RS256' });

      // Installation Access Token取得
      const response = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new ValidationError('installation_id が不正、またはこの App のインストールではありません。');
        }
        throw new ExternalServiceError('GitHub', `GitHub API エラー: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as any;
      return data.token;
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }
      Logger.error('Installation token取得失敗', error as Error);
      throw new ExternalServiceError('GitHub', 'GitHub App認証に失敗しました。');
    }
  }

  // リポジトリアクセス検証
  async validateRepoAccess(installationToken: string, repo: string): Promise<void> {
    try {
      const response = await fetch('https://api.github.com/installation/repositories', {
        headers: {
          'Authorization': `token ${installationToken}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });

      if (!response.ok) {
        throw new ExternalServiceError('GitHub', `リポジトリ一覧取得失敗: ${response.status}`);
      }

      const data = await response.json() as any;
      const repos = data.repositories || [];
      const repoExists = repos.some((r: any) => r.full_name === repo);

      if (!repoExists) {
        throw new ValidationError('App が指定リポジトリにアクセスできません。GitHub で App のインストール対象に当該リポジトリを追加してください。');
      }
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }
      Logger.error('リポジトリアクセス検証失敗', error as Error);
      throw new ExternalServiceError('GitHub', 'リポジトリアクセス検証に失敗しました。');
    }
  }

  // インストール情報取得
  async getInstallationInfo(installationId: string, installationToken: string): Promise<any> {
    try {
      const response = await fetch(`https://api.github.com/app/installations/${installationId}`, {
        headers: {
          'Authorization': `token ${installationToken}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });

      if (!response.ok) {
        throw new ExternalServiceError('GitHub', `インストール情報取得失敗: ${response.status}`);
      }

      return await response.json() as any;
    } catch (error) {
      Logger.error('インストール情報取得失敗', error as Error);
      throw new ExternalServiceError('GitHub', 'インストール情報取得に失敗しました。');
    }
  }

  // 原子書き込み（一時ファイル経由）
  private async atomicWrite(filePath: string, content: string): Promise<void> {
    const tempPath = `${filePath}.tmp`;
    await fs.promises.writeFile(tempPath, content, 'utf-8');
    await fs.promises.rename(tempPath, filePath);
  }

  // guild_mappingsファイルのupsert
  async upsertGuildMapping(guildId: string, guildName: string, installationId: string, repo: string): Promise<void> {
    const filePath = path.join(this.guildMappingsDir, `${guildId}.yml`);
    
    const mapping: GuildMapping = {
      tenant_id: installationId,
      installation_id: installationId,
      default_repo: repo,
      channel_overrides: {},
      updated_at: new Date().toISOString()
    };

    const content = yaml.dump(mapping);
    await this.atomicWrite(filePath, content);
    
    Logger.info('Guild mapping updated', { guildId, installationId, repo });
  }

  // installationsファイルのupsert
  async upsertInstallation(installationId: string, installationInfo: any, repo: string): Promise<void> {
    const filePath = path.join(this.installationsDir, `${installationId}.yml`);
    
    const installation: Installation = {
      installation_id: installationId,
      app_id: process.env.GITHUB_APP_ID || '',
      account_login: installationInfo.account?.login || '',
      account_type: installationInfo.account?.type || 'User',
      selected_repos: [repo],
      updated_at: new Date().toISOString()
    };

    const content = yaml.dump(installation);
    await this.atomicWrite(filePath, content);
    
    Logger.info('Installation updated', { installationId, repo });
  }

  // メインの設定処理
  async configureGuild(guildId: string, guildName: string, repo: string, installationId: string): Promise<void> {
    try {
      // 1. 入力値の形式検証
      this.validateRepoFormat(repo);
      this.validateInstallationId(installationId);

      // 2. App認証 → installation token発行
      const installationToken = await this.getInstallationToken(installationId);

      // 3. tokenでrepoアクセス検証
      await this.validateRepoAccess(installationToken, repo);

      // 4. インストール情報取得
      const installationInfo = await this.getInstallationInfo(installationId, installationToken);

      // 5. guild_mappings/{guildId}.ymlをupsert
      await this.upsertGuildMapping(guildId, guildName, installationId, repo);

      // 6. installations/{installation_id}.ymlをupsert
      await this.upsertInstallation(installationId, installationInfo, repo);

      Logger.info('Configuration completed successfully', { guildId, repo, installationId });
    } catch (error) {
      Logger.error('Configuration failed', error as Error, { guildId, repo, installationId });
      throw error;
    }
  }
} 