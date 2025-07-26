import { Message, AttachmentBuilder } from 'discord.js';
import { Logger } from '../../shared/logger';
import { ErrorHandler, ValidationError } from '../../shared/error-handler';
import { Metrics } from '../../shared/metrics';
import { ProcessedFile } from '../../shared/types';
import { GitHubService } from '../../api/services/github.service';
import { OpenAIService } from '../../api/services/openai.service';
import { issueTextWaitMap, insertTextWaitMap } from './interaction-handler';

export class MessageHandler {
  private githubService: GitHubService;
  private openaiService: OpenAIService;
  private readonly supportedExtensions = ['.md', '.txt', '.json', '.yml', '.yaml'];
  private readonly maxFileSize = 10 * 1024 * 1024; // 10MB

  constructor() {
    this.githubService = new GitHubService();
    this.openaiService = new OpenAIService();
  }

  async handleMessage(message: Message): Promise<void> {
    // デバッグ用：メッセージ受信の詳細ログ
    Logger.info('Discord message received', {
      messageId: message.id,
      authorId: message.author.id,
      authorUsername: message.author.username,
      authorBot: message.author.bot,
      guildId: message.guild?.id || 'DM',
      channelId: message.channel.id,
      attachmentCount: message.attachments.size,
      contentLength: message.content.length,
      hasGuild: !!message.guild
    });

    if (message.author.bot) {
      Logger.info('Message from bot - skipping', { authorId: message.author.id });
      return;
    }

    if (!message.guild) {
      Logger.info('Message not in guild (DM) - skipping', { authorId: message.author.id });
      return;
    }

    // /issue text 入力待ち状態のユーザーか？
    const waitChannelId = issueTextWaitMap.get(message.author.id);
    if (waitChannelId && message.channel.id === waitChannelId) {
      // テキスト発言をIssueとして処理
      try {
        const processedFile: ProcessedFile = {
          original_name: `issue-from-text.md`,
          content: message.content,
          size: Buffer.byteLength(message.content, 'utf-8'),
          type: 'markdown'
        };
        const result = await this.githubService.processFileUpload(
          message.guild!.id,
          message.channel.id,
          message.author.id,
          processedFile
        );
        await message.reply(`✅ Issue created: ${result.url}`);
        Metrics.recordDiscordMessage(message.guild!.id, 'success');
      } catch (error) {
        await ErrorHandler.handleError(error as Error, {
          guildId: message.guild?.id,
          channelId: message.channel.id,
          userId: message.author.id,
          operation: 'issue_text_upload'
        });
        Metrics.recordDiscordMessage(message.guild?.id || 'unknown', 'error');
        await message.reply(`❌ Issue作成中にエラー: ${ErrorHandler.getErrorMessage(error as Error)}`);
      } finally {
        issueTextWaitMap.delete(message.author.id);
      }
      return;
    }

    // /insert 入力待ち状態のユーザーか？
    const insertWaitInfo = insertTextWaitMap.get(message.author.id);
    if (insertWaitInfo && message.channel.id === insertWaitInfo.channelId) {
      // テキスト発言をinsertとして処理
      try {
        const formattedContent = await this.openaiService.formatWithInsert(
          message.content,
          insertWaitInfo.style
        );
        
        // 元文章と整形された文章を組み合わせてIssueを作成
        const combinedContent = `# 📝 元の文章\n\n${message.content}\n\n---\n\n# ✨ 整形された文章\n\n${formattedContent}`;
        
        const processedFile: ProcessedFile = {
          original_name: `insert-${insertWaitInfo.style}-formatted.md`,
          content: combinedContent,
          size: Buffer.byteLength(combinedContent, 'utf-8'),
          type: 'markdown'
        };
        
        const result = await this.githubService.processFileUpload(
          message.guild!.id,
          message.channel.id,
          message.author.id,
          processedFile,
          true // skipSummary: insertコマンドの場合は要約をスキップ
        );
        
        await message.reply(`✅ Markdown整形完了 & Issue作成:\n\n${formattedContent}\n\n📎 Issue: ${result.url}`);
        Metrics.recordDiscordMessage(message.guild!.id, 'success');
      } catch (error) {
        await ErrorHandler.handleError(error as Error, {
          guildId: message.guild?.id,
          channelId: message.channel.id,
          userId: message.author.id,
          operation: 'insert_text_format'
        });
        Metrics.recordDiscordMessage(message.guild?.id || 'unknown', 'error');
        await message.reply(`❌ Markdown整形中にエラー: ${ErrorHandler.getErrorMessage(error as Error)}`);
      } finally {
        insertTextWaitMap.delete(message.author.id);
      }
      return;
    }

    try {
      const attachments = Array.from(message.attachments.values());
      
      if (attachments.length === 0) {
        Logger.info('No attachments in message - skipping', {
          guildId: message.guild.id,
          channelId: message.channel.id,
          userId: message.author.id,
          contentPreview: message.content.substring(0, 50)
        });
        return;
      }

      Logger.info(`Processing message with ${attachments.length} attachment(s)`, {
        guildId: message.guild.id,
        channelId: message.channel.id,
        userId: message.author.id,
        username: message.author.username
      });

      for (const attachment of attachments) {
        await this.processAttachment(message, attachment);
      }

      Metrics.recordDiscordMessage(message.guild.id, 'success');

    } catch (error) {
      await ErrorHandler.handleError(error as Error, {
        guildId: message.guild?.id,
        channelId: message.channel.id,
        userId: message.author.id,
        operation: 'file_upload'
      });

      Metrics.recordDiscordMessage(message.guild?.id || 'unknown', 'error');

      await this.sendErrorMessage(message, error as Error);
    }
  }

  private async processAttachment(message: Message, attachment: any): Promise<void> {
    try {
      // Validate file extension
      const fileName = attachment.name.toLowerCase();
      const isSupported = this.supportedExtensions.some(ext => fileName.endsWith(ext));
      
      if (!isSupported) {
        throw new ValidationError('サポートされていないファイル形式です。', {
          fileName: attachment.name,
          supportedExtensions: this.supportedExtensions
        });
      }

      // Validate file size
      if (attachment.size > this.maxFileSize) {
        throw new ValidationError(`ファイルサイズが大きすぎます。最大${this.formatFileSize(this.maxFileSize)}まで対応しています。`, {
          fileName: attachment.name,
          fileSize: attachment.size,
          maxSize: this.maxFileSize
        });
      }

      Logger.info(`Processing attachment`, {
        fileName: attachment.name,
        fileSize: attachment.size,
        url: attachment.url
      });

      // Download and process file
      const processedFile = await this.downloadAndProcessFile(attachment);
      
      // GitHub連携を復活
      const result = await this.githubService.processFileUpload(
        message.guild!.id,
        message.channel.id,
        message.author.id,
        processedFile
      );

      // Reply with success message
      await this.sendSuccessMessage(message, result, processedFile);

    } catch (error) {
      Logger.error(`Failed to process attachment`, error as Error, {
        fileName: attachment.name,
        fileSize: attachment.size
      });

      throw error;
    }
  }

  private async downloadAndProcessFile(attachment: any): Promise<ProcessedFile> {
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
      Logger.error(`Failed to download file`, error as Error, {
        fileName: attachment.name,
        url: attachment.url
      });

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

  private async sendSuccessMessage(
    message: Message,
    result: any,
    file: ProcessedFile
  ): Promise<void> {
    try {
      const isIssue = 'number' in result;
      const emoji = isIssue ? '🎯' : '📝';
      const type = isIssue ? 'Issue' : 'Gist';
      
      const embed = {
        color: 0x00ff00,
        title: `${emoji} ${type}を作成しました`,
        description: `ファイル「${file.original_name}」の処理が完了しました。`,
        fields: [
          {
            name: '📄 ファイル情報',
            value: `**名前:** ${file.original_name}\n**サイズ:** ${this.formatFileSize(file.size)}\n**タイプ:** ${file.type}`,
            inline: true
          },
          {
            name: `🔗 ${type}リンク`,
            value: `[こちらから確認](${result.url})`,
            inline: true
          }
        ],
        footer: {
          text: 'Discord-GitHub Integration Bot',
          icon_url: 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png'
        },
        timestamp: new Date().toISOString()
      };

      await message.reply({ embeds: [embed] });

    } catch (error) {
      Logger.error(`Failed to send success message`, error as Error);
      
      // Fallback to simple text message
      await message.reply(`✅ ファイル「${file.original_name}」の処理が完了しました。\n🔗 ${result.url}`);
    }
  }

  private async sendErrorMessage(message: Message, error: Error): Promise<void> {
    try {
      const isValidationError = error instanceof ValidationError;
      const emoji = isValidationError ? '⚠️' : '❌';
      
      const embed = {
        color: isValidationError ? 0xffa500 : 0xff0000,
        title: `${emoji} ${isValidationError ? '入力エラー' : 'エラーが発生しました'}`,
        description: ErrorHandler.getErrorMessage(error),
        footer: {
          text: 'Discord-GitHub Integration Bot',
          icon_url: 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png'
        },
        timestamp: new Date().toISOString()
      };

      const embedWithFields: any = embed;
      if (isValidationError) {
        embedWithFields.fields = [
          {
            name: '📋 サポートされているファイル形式',
            value: this.supportedExtensions.join(', '),
            inline: false
          },
          {
            name: '📏 最大ファイルサイズ',
            value: this.formatFileSize(this.maxFileSize),
            inline: false
          }
        ];
      }

      await message.reply({ embeds: [embed] });

    } catch (replyError) {
      Logger.error(`Failed to send error message`, replyError as Error);
      
      // Fallback to simple text message
      try {
        await message.reply(`❌ ${ErrorHandler.getErrorMessage(error)}`);
      } catch (fallbackError) {
        Logger.error(`Failed to send fallback error message`, fallbackError as Error);
      }
    }
  }

  private formatFileSize(bytes: number): string {
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 Bytes';
    
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  }
}