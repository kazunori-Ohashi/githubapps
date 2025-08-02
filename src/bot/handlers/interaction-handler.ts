
import { Interaction, CommandInteraction, Attachment, CacheType, ChatInputCommandInteraction } from 'discord.js';
import { Logger } from '../../shared/logger';
import { ErrorHandler, ValidationError } from '../../shared/error-handler';
import { Metrics } from '../../shared/metrics';
import { GitHubService } from '../../api/services/github.service';
import { TwitterService } from '../../api/services/twitter.service';
import { OpenAIService } from '../../api/services/openai.service';
import { FileProcessorService } from '../../api/services/file-processor.service';
import { ConfigService } from '../../api/services/config.service';
import { ProcessedFile } from '../../shared/types';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// 入力待ち状態管理用のMap（グローバルで仮実装）
export const issueTextWaitMap = new Map<string, string>(); // userId -> channelId
export const insertTextWaitMap = new Map<string, { channelId: string, style: 'prep' | 'pas' }>(); // userId -> { channelId, style }

export class InteractionHandler {
  private githubService: GitHubService;
  private twitterService: TwitterService;
  private openaiService: OpenAIService;
  private fileProcessorService: FileProcessorService;
  private configService: ConfigService;
  private readonly supportedExtensions = ['.md', '.txt', '.json', '.yml', '.yaml'];

  constructor() {
    this.githubService = new GitHubService();
    this.twitterService = new TwitterService();
    this.openaiService = new OpenAIService();
    this.fileProcessorService = new FileProcessorService();
    this.configService = new ConfigService();
  }

  async handleInteraction(interaction: Interaction): Promise<void> {
    if (!interaction.isCommand()) return;

    const { commandName } = interaction;

    if (commandName === 'issue') {
      await this.handleIssueTextCommand(interaction as ChatInputCommandInteraction);
    } else if (commandName === 'insert') {
      await this.handleInsertCommand(interaction as ChatInputCommandInteraction);
    } else if (commandName === 'article') {
      await this.handleArticleCommand(interaction as ChatInputCommandInteraction);
    } else if (commandName === 'config') {
      await this.handleConfigCommand(interaction as ChatInputCommandInteraction);
    }
  }



  private async handleIssueTextCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      if (!interaction.guild) {
        throw new ValidationError('このコマンドはサーバー内でのみ使用できます。');
      }
      // 入力待ち状態に登録
      issueTextWaitMap.set(interaction.user.id, interaction.channelId);
      await interaction.reply({ content: '✏️ 次の発言をIssueとして処理します。テキストを入力してください。', ephemeral: true });
    } catch (error) {
      const guildId = interaction.guild?.id;
      const channelId = interaction.channelId;
      const context = {
        userId: interaction.user.id,
        operation: 'issue_command',
        ...(guildId ? { guildId } : {}),
        ...(channelId ? { channelId } : {}),
      };
      await ErrorHandler.handleError(error as Error, context);
      if (interaction.replied || interaction.deferred) {
        await interaction.editReply(`❌ ${ErrorHandler.getErrorMessage(error as Error)}`);
      } else {
        await interaction.reply({ content: `❌ ${ErrorHandler.getErrorMessage(error as Error)}`, ephemeral: true });
      }
    }
  }

  private async handleInsertCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      if (!interaction.guild) {
        throw new ValidationError('このコマンドはサーバー内でのみ使用できます。');
      }
      
      const style = interaction.options.getString('style', true) as 'prep' | 'pas';
      
      // 入力待ち状態に登録
      insertTextWaitMap.set(interaction.user.id, {
        channelId: interaction.channelId,
        style: style
      });
      
      const styleName = style === 'prep' ? 'PREP法' : 'PAS法';
      await interaction.reply({ 
        content: `✏️ 次の発言を${styleName}でMarkdown整形します。テキストを入力してください。`, 
        ephemeral: true 
      });
    } catch (error) {
      const guildId = interaction.guild?.id;
      const channelId = interaction.channelId;
      const context = {
        userId: interaction.user.id,
        operation: 'insert_command',
        ...(guildId ? { guildId } : {}),
        ...(channelId ? { channelId } : {}),
      };
      await ErrorHandler.handleError(error as Error, context);
      if (interaction.replied || interaction.deferred) {
        await interaction.editReply(`❌ ${ErrorHandler.getErrorMessage(error as Error)}`);
      } else {
        await interaction.reply({ content: `❌ ${ErrorHandler.getErrorMessage(error as Error)}`, ephemeral: true });
      }
    }
  }

  private async handleArticleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      if (!interaction.guild) {
        throw new ValidationError('このコマンドはサーバー内でのみ使用できます。');
      }
      
      const attachment = interaction.options.getAttachment('file', true);
      const style = interaction.options.getString('style', true) as 'prep' | 'pas';
      
      // ファイル形式の検証
      if (!this.fileProcessorService.isSupportedFile(attachment.name)) {
        const supportedExtensions = this.fileProcessorService.getSupportedExtensions().join(', ');
        throw new ValidationError(`サポートされていないファイル形式です。対応形式: ${supportedExtensions}`);
      }
      
      await interaction.deferReply();
      
      // ファイルをダウンロードして一時ファイルとして保存
      const tempFilePath = await this.downloadFileToTemp(attachment);
      
      // ファイル処理サービスでファイルを処理
      const fileResult = await this.fileProcessorService.processFile(
        tempFilePath,
        attachment.name,
        attachment.size
      );
      
      // OpenAIで整形
      const formattedContent = await this.openaiService.formatWithInsert(
        fileResult.content,
        style
      );
      
      // GitHub Issueとして保存
      const combinedContent = `# 📝 元のファイル\n\n**ファイル名:** ${fileResult.originalName}\n**ファイルサイズ:** ${this.formatFileSize(fileResult.size)}\n**ファイルタイプ:** ${fileResult.type}\n\n---\n\n# ✨ 整形された文章\n\n${formattedContent}`;
      
      const issueFile: ProcessedFile = {
        original_name: `article-${style}-formatted.md`,
        content: combinedContent,
        size: Buffer.byteLength(combinedContent, 'utf-8'),
        type: 'markdown'
      };
      
      const result = await this.githubService.processFileUpload(
        interaction.guild.id,
        interaction.channelId,
        interaction.user.id,
        issueFile,
        true // skipSummary: articleコマンドの場合は要約をスキップ
      );
      
      const styleName = style === 'prep' ? 'PREP法' : 'PAS法';
      await interaction.editReply(`✅ ファイル処理 & ${styleName}整形完了:\n\n${formattedContent}\n\n📎 Issue: ${result.url}`);
      Metrics.recordDiscordMessage(interaction.guild.id, 'success');
      
    } catch (error) {
      const guildId = interaction.guild?.id;
      const channelId = interaction.channelId;
      const context = {
        userId: interaction.user.id,
        operation: 'article_command',
        ...(guildId ? { guildId } : {}),
        ...(channelId ? { channelId } : {}),
      };
      await ErrorHandler.handleError(error as Error, context);
      Metrics.recordDiscordMessage(interaction.guild?.id || 'unknown', 'error');
      if (interaction.replied || interaction.deferred) {
        await interaction.editReply(`❌ ${ErrorHandler.getErrorMessage(error as Error)}`);
      } else {
        await interaction.reply({ content: `❌ ${ErrorHandler.getErrorMessage(error as Error)}`, ephemeral: true });
      }
    }
  }

  private formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  private validateFile(attachment: Attachment): void {
    const fileName = attachment.name.toLowerCase();
    const isSupported = this.supportedExtensions.some(ext => fileName.endsWith(ext));
    if (!isSupported) {
      throw new ValidationError(`Unsupported file type. Allowed: ${this.supportedExtensions.join(', ')}`);
    }
  }

  private async downloadAndProcessFile(attachment: Attachment): Promise<ProcessedFile> {
    try {
      const response = await fetch(attachment.url);
      if (!response.ok) {
        throw new Error(`Failed to download file: ${response.statusText}`);
      }
      const content = await response.text();
      return {
        original_name: attachment.name,
        content,
        size: attachment.size,
        type: this.getFileType(attachment.name)
      };
    } catch (error) {
      throw new Error(`ファイルのダウンロードに失敗しました: ${(error as Error).message}`);
    }
  }

  private getFileType(fileName: string): string {
    const extension = fileName.toLowerCase().split('.').pop();
    const typeMap: Record<string, string> = {
      'md': 'markdown',
      'txt': 'text',
      'json': 'json',
      'yml': 'yaml',
      'yaml': 'yaml'
    };
    return typeMap[extension || ''] || 'unknown';
  }

  private async downloadFileToTemp(attachment: Attachment): Promise<string> {
    try {
      const response = await fetch(attachment.url);
      if (!response.ok) {
        throw new Error(`Failed to download file: ${response.statusText}`);
      }
      
      const buffer = await response.arrayBuffer();
      const tempDir = os.tmpdir();
      const tempFilePath = path.join(tempDir, attachment.name);
      
      await fs.promises.writeFile(tempFilePath, Buffer.from(buffer));
      
      return tempFilePath;
             } catch (error) {
           throw new Error(`ファイルのダウンロードに失敗しました: ${(error as Error).message}`);
         }
       }

       private async handleConfigCommand(interaction: ChatInputCommandInteraction): Promise<void> {
         try {
           if (!interaction.guild) {
             throw new ValidationError('このコマンドはサーバー内でのみ使用できます。');
           }

           // 権限チェック
           if (!interaction.memberPermissions?.has('ManageGuild')) {
             throw new ValidationError('このコマンドはサーバー管理権限が必要です。');
           }

           const repo = interaction.options.getString('repo', true);
           const installationId = interaction.options.getString('installation', true);

           await interaction.deferReply({ ephemeral: true });

           // 設定処理実行
           await this.configService.configureGuild(
             interaction.guild.id,
             interaction.guild.name,
             repo,
             installationId
           );

           // 成功メッセージ
           const [owner, repoName] = repo.split('/');
           await interaction.editReply(
             `✅ このサーバーを ${owner}/${repoName} (installation: ${installationId}) に紐付けました。\n` +
             `ℹ️ /config-status で現設定を確認できます。/config-test で疎通テストできます。`
           );

           Metrics.recordDiscordMessage(interaction.guild.id, 'success');

         } catch (error) {
           const guildId = interaction.guild?.id;
           const channelId = interaction.channelId;
           const context = {
             userId: interaction.user.id,
             operation: 'config_command',
             ...(guildId ? { guildId } : {}),
             ...(channelId ? { channelId } : {}),
           };
           await ErrorHandler.handleError(error as Error, context);
           Metrics.recordDiscordMessage(interaction.guild?.id || 'unknown', 'error');
           
           if (interaction.replied || interaction.deferred) {
             await interaction.editReply(`❌ ${ErrorHandler.getErrorMessage(error as Error)}`);
           } else {
             await interaction.reply({ 
               content: `❌ ${ErrorHandler.getErrorMessage(error as Error)}`, 
               ephemeral: true 
             });
           }
         }
       }
     }
