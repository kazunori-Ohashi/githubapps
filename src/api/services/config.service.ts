import * as fs from 'fs';
import * as path from 'path';
import jwt from 'jsonwebtoken';
import { Logger } from '../../shared/logger';
import { ValidationError, ExternalServiceError } from '../../shared/error-handler';
import { FileUtils } from '../../shared/file-utils';
import { GuildMapping as GuildMappingType, GitHubInstallation as GitHubInstallationType } from '../../shared/types';

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

  // App JWT 生成（\n を実際の改行に置換）
  private generateAppJwt(): string {
    const appId = process.env.GITHUB_APP_ID;
    const privateKeyRaw = process.env.GITHUB_APP_PRIVATE_KEY;
    if (!appId || !privateKeyRaw) {
      throw new ExternalServiceError('GitHub', 'GitHub App設定が不完全です。');
    }

    const privateKey = privateKeyRaw.replace(/\\n/g, '\n');
    const payload = {
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 10 * 60,
      iss: appId,
    };
    return jwt.sign(payload, privateKey, { algorithm: 'RS256' });
  }

  // GitHub API認証とトークン発行（Installation Access Token）
  async getInstallationToken(installationId: string): Promise<string> {
    try {
      const token = this.generateAppJwt();

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

  // インストール情報取得（App JWT で認証）
  async getInstallationInfo(installationId: string): Promise<any> {
    try {
      const token = this.generateAppJwt();
      const response = await fetch(`https://api.github.com/app/installations/${installationId}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
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

  // guild_mappings の read-modify-write での安全な更新
  async upsertGuildMapping(guildId: string, guildName: string, installationId: string, repo: string): Promise<void> {
    const existing = await FileUtils.getGuildMapping(guildId);
    const parts = repo.split('/');
    const owner: string | undefined = parts[0];
    const name: string | undefined = parts[1];
    if (!owner || !name) {
      throw new ValidationError('repo 解析エラー：owner/repo の形式に分解できませんでした。');
    }
    const now = new Date().toISOString();

    const mapping: GuildMappingType = existing
      ? {
          ...existing,
          guild_id: guildId,
          guild_name: guildName || existing.guild_name,
          installation_id: parseInt(installationId, 10),
          default_repo: { owner, name },
          updated_at: now,
          channels: existing.channels || [],
        }
      : {
          guild_id: guildId,
          guild_name: guildName,
          installation_id: parseInt(installationId, 10),
          default_repo: { owner, name },
          channels: [],
          created_at: now,
          updated_at: now,
        };

    await FileUtils.saveGuildMapping(mapping);
    Logger.info('Guild mapping updated', { guildId, installationId, repo });
  }

  // installations の更新（shared/types に統一）
  async upsertInstallation(installationId: string, installationInfo: any): Promise<void> {
    const installation: GitHubInstallationType = {
      installation_id: parseInt(installationId, 10),
      app_id: installationInfo.app_id,
      account: {
        login: installationInfo.account?.login || '',
        id: installationInfo.account?.id || 0,
        type: installationInfo.account?.type || 'User',
      },
      // repositories は App API 応答に含まれないため省略（optional）
      permissions: installationInfo.permissions || {},
      created_at: installationInfo.created_at,
      updated_at: installationInfo.updated_at,
      suspended_at: installationInfo.suspended_at || undefined,
    };

    await FileUtils.saveInstallation(installation);
    Logger.info('Installation updated', { installationId });
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
      const installationInfo = await this.getInstallationInfo(installationId);

      // 5. guild_mappings/{guildId}.ymlをupsert
      await this.upsertGuildMapping(guildId, guildName, installationId, repo);

      // 6. installations/{installation_id}.ymlをupsert
      await this.upsertInstallation(installationId, installationInfo);

      Logger.info('Configuration completed successfully', { guildId, repo, installationId });
    } catch (error) {
      Logger.error('Configuration failed', error as Error, { guildId, repo, installationId });
      throw error;
    }
  }
}
