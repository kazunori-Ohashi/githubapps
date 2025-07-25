import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';
import { Logger } from '../../shared/logger';
import { ExternalServiceError, NotFoundError, UnauthorizedError } from '../../shared/error-handler';
import { Metrics } from '../../shared/metrics';
import { FileUtils } from '../../shared/file-utils';
import { ProcessedFile, GitHubCreateIssueRequest, GitHubCreateGistRequest, OperationLog } from '../../shared/types';
import { OpenAIService } from './openai.service';

export interface GitHubIssueResult {
  url: string;
  number: number;
  title: string;
}

export interface GitHubGistResult {
  url: string;
  id: string;
  description: string;
}

export class GitHubService {
  private app: Octokit;
  private installationClients: Map<number, Octokit> = new Map();
  private openaiService: OpenAIService;

  constructor() {
    const appId = process.env.GITHUB_APP_ID;
    const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;

    if (!appId || !privateKey) {
      throw new Error('GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY environment variables are required');
    }

    this.app = new Octokit({
      authStrategy: createAppAuth,
      auth: {
        appId: parseInt(appId),
        privateKey: privateKey.replace(/\\n/g, '\n'),
      },
    });

    this.openaiService = new OpenAIService();
  }

  async processFileUpload(
    guildId: string,
    channelId: string,
    userId: string,
    file: ProcessedFile
  ): Promise<GitHubIssueResult | GitHubGistResult> {
    const startTime = Date.now();
    
    try {
      Logger.info(`Processing file upload`, {
        guildId,
        channelId,
        fileName: file.original_name,
        fileSize: file.size
      });

      const guildMapping = await FileUtils.getGuildMapping(guildId);
      if (!guildMapping) {
        throw new NotFoundError('GitHub App がインストールされていません', {
          guildId
        });
      }

      const targetRepo = this.getTargetRepo(guildMapping, channelId);
      const installationClient = await this.getInstallationClient(guildMapping.installation_id);

      const summary = await this.openaiService.summarizeFile(file);

      const isLargeFile = file.size > 512 * 1024; // 512KB threshold
      
      let result: GitHubIssueResult | GitHubGistResult;
      
      if (isLargeFile) {
        result = await this.createGist(installationClient, file, summary);
      } else {
        result = await this.createIssue(installationClient, targetRepo, file, summary);
      }

      await this.logSuccess(guildId, channelId, userId, file, result, summary);

      const duration = (Date.now() - startTime) / 1000;
      Logger.info(`File processing completed`, {
        guildId,
        fileName: file.original_name,
        resultType: isLargeFile ? 'gist' : 'issue',
        duration: `${duration}s`
      });

      Metrics.recordFileProcessing(file.type, duration);
      
      return result;

    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      
      Logger.error(`File processing failed`, error as Error, {
        guildId,
        fileName: file.original_name,
        duration: `${duration}s`
      });

      await this.logError(guildId, channelId, userId, file, error as Error);
      
      throw error;
    }
  }

  private async getInstallationClient(installationId: number): Promise<Octokit> {
    if (this.installationClients.has(installationId)) {
      return this.installationClients.get(installationId)!;
    }

    try {
      // 修正版: authにオプションオブジェクトを直接渡す
      const client = new Octokit({
        authStrategy: createAppAuth,
        auth: {
          appId: parseInt(process.env.GITHUB_APP_ID!),
          privateKey: process.env.GITHUB_APP_PRIVATE_KEY!.replace(/\\n/g, '\n'),
          installationId,
        },
      });

      // Test the client
      await client.rest.apps.getInstallation({ installation_id: installationId });
      
      this.installationClients.set(installationId, client);
      
      Logger.debug(`Created installation client`, { installationId });
      
      return client;
      
    } catch (error) {
      Logger.error(`Failed to create installation client`, error as Error, {
        installationId,
        errorMessage: (error as Error).message,
        errorStack: (error as Error).stack,
        errorRaw: error
      });
      
      if ((error as any).status === 404) {
        throw new NotFoundError('GitHub App installation not found');
      }
      // 元エラーのメッセージもUnauthorizedErrorに含める
      throw new UnauthorizedError('Failed to authenticate with GitHub App: ' + (error as Error).message);
    }
  }

  private getTargetRepo(guildMapping: any, channelId: string): { owner: string; name: string } {
    const channelOverride = guildMapping.channels?.find(
      (ch: any) => ch.channel_id === channelId && ch.repo_override
    );
    
    return channelOverride?.repo_override || guildMapping.default_repo;
  }

  private async createIssue(
    client: Octokit,
    repo: { owner: string; name: string },
    file: ProcessedFile,
    summary: string
  ): Promise<GitHubIssueResult> {
    try {
      // タイトルを現在時刻のYYYYMMDDHHmm形式に
      const now = new Date();
      const pad = (n: number) => n.toString().padStart(2, '0');
      const title = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}`;
      const request: GitHubCreateIssueRequest = {
        title,
        body: this.buildIssueBody(file, summary),
        labels: ['discord-upload', 'auto-generated'],
      };

      const response = await client.rest.issues.create({
        owner: repo.owner,
        repo: repo.name,
        ...request,
      });

      Metrics.recordGitHubApiCall('issues.create', 'success');

      return {
        url: response.data.html_url,
        number: response.data.number,
        title: response.data.title,
      };

    } catch (error) {
      Metrics.recordGitHubApiCall('issues.create', 'error');
      
      Logger.error(`Failed to create GitHub issue`, error as Error, {
        repo: `${repo.owner}/${repo.name}`,
        fileName: file.original_name
      });

      throw new ExternalServiceError('GitHub', `Failed to create issue: ${(error as Error).message}`);
    }
  }

  private async createGist(
    client: Octokit,
    file: ProcessedFile,
    summary: string
  ): Promise<GitHubGistResult> {
    try {
      const request: GitHubCreateGistRequest = {
        description: `📄 ${file.original_name} (via Discord)`,
        public: false,
        files: {
          [file.original_name]: {
            content: file.content
          },
          'README.md': {
            content: this.buildGistReadme(file, summary)
          }
        }
      };

      const response = await client.rest.gists.create({
        description: request.description,
        public: request.public,
        files: request.files
      });

      Metrics.recordGitHubApiCall('gists.create', 'success');

      return {
        url: response.data.html_url!,
        id: response.data.id!,
        description: response.data.description || '',
      };

    } catch (error) {
      Metrics.recordGitHubApiCall('gists.create', 'error');
      
      Logger.error(`Failed to create GitHub gist`, error as Error, {
        fileName: file.original_name
      });

      throw new ExternalServiceError('GitHub', `Failed to create gist: ${(error as Error).message}`);
    }
  }

  private buildIssueBody(file: ProcessedFile, summary: string): string {
    return `## 📋 要約

${summary}

## 📎 Original Content

**ファイル名:** ${file.original_name}  
**ファイルサイズ:** ${this.formatFileSize(file.size)}  
**ファイルタイプ:** ${file.type}

\`\`\`
${file.content}
\`\`\`

---
*このIssueはDiscordから自動生成されました*`;
  }

  private buildGistReadme(file: ProcessedFile, summary: string): string {
    return `# ${file.original_name}

## 📋 要約

${summary}

## 📋 ファイル情報

- **ファイル名:** ${file.original_name}
- **ファイルサイズ:** ${this.formatFileSize(file.size)}
- **ファイルタイプ:** ${file.type}
- **アップロード日時:** ${new Date().toISOString()}

---
*このGistはDiscordから自動生成されました*`;
  }

  private formatFileSize(bytes: number): string {
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 Bytes';
    
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  }

  private async logSuccess(
    guildId: string,
    channelId: string,
    userId: string,
    file: ProcessedFile,
    result: GitHubIssueResult | GitHubGistResult,
    summary: string
  ): Promise<void> {
    const operation: OperationLog = {
      id: this.generateId(),
      timestamp: new Date().toISOString(),
      guild_id: guildId,
      channel_id: channelId,
      user_id: userId,
      operation_type: 'url' in result ? 'issue_creation' : 'gist_creation',
      status: 'success',
      details: {
        file_name: file.original_name,
        file_size: file.size,
        file_type: file.type,
        github_url: result.url,
        ai_summary_length: summary.length
      }
    };

    await FileUtils.logOperation(operation);
  }

  private async logError(
    guildId: string,
    channelId: string,
    userId: string,
    file: ProcessedFile,
    error: Error
  ): Promise<void> {
    const operation: OperationLog = {
      id: this.generateId(),
      timestamp: new Date().toISOString(),
      guild_id: guildId,
      channel_id: channelId,
      user_id: userId,
      operation_type: 'file_upload',
      status: 'error',
      details: {
        file_name: file.original_name,
        file_size: file.size,
        file_type: file.type,
        error_message: error.message
      }
    };

    await FileUtils.logOperation(operation);
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  async handleInstallationCreated(installationId: number, payload: any): Promise<void> {
    try {
      Logger.info(`Handling installation created`, { installationId });

      const installation = {
        installation_id: installationId,
        app_id: payload.installation.app_id,
        account: {
          login: payload.installation.account.login,
          id: payload.installation.account.id,
          type: payload.installation.account.type,
        },
        repositories: payload.repositories?.map((repo: any) => ({
          id: repo.id,
          name: repo.name,
          full_name: repo.full_name,
        })),
        permissions: payload.installation.permissions,
        created_at: payload.installation.created_at,
        updated_at: payload.installation.updated_at,
      };

      await FileUtils.saveInstallation(installation);
      
      Logger.info(`Installation saved`, { installationId });

    } catch (error) {
      Logger.error(`Failed to handle installation created`, error as Error, { installationId });
      throw error;
    }
  }

  async handleInstallationDeleted(installationId: number): Promise<void> {
    try {
      Logger.info(`Handling installation deleted`, { installationId });

      // Remove installation client from cache
      this.installationClients.delete(installationId);

      // Remove installation file
      await FileUtils.deleteInstallation(installationId);

      // Remove all guild mappings for this installation
      const guilds = await FileUtils.findGuildsByInstallation(installationId);
      for (const guild of guilds) {
        await FileUtils.deleteGuildMapping(guild.guild_id);
      }

      Logger.info(`Installation cleanup completed`, { 
        installationId,
        affectedGuilds: guilds.length 
      });

    } catch (error) {
      Logger.error(`Failed to handle installation deleted`, error as Error, { installationId });
      throw error;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.app.rest.apps.getAuthenticated();
      return true;
    } catch (error) {
      Logger.error('GitHub health check failed', error as Error);
      return false;
    }
  }
}