
import { Interaction, CommandInteraction, Attachment, CacheType, ChatInputCommandInteraction } from 'discord.js';
import { Logger } from '../../shared/logger';
import { ErrorHandler, ValidationError } from '../../shared/error-handler';
import { Metrics } from '../../shared/metrics';
import { GitHubService } from '../../api/services/github.service';
import { TwitterService } from '../../api/services/twitter.service';
import { OpenAIService } from '../../api/services/openai.service';
import { ProcessedFile } from '../../shared/types';

// 入力待ち状態管理用のMap（グローバルで仮実装）
export const issueTextWaitMap = new Map<string, string>(); // userId -> channelId
export const insertTextWaitMap = new Map<string, { channelId: string, style: 'prep' | 'pas' }>(); // userId -> { channelId, style }

export class InteractionHandler {
  private githubService: GitHubService;
  private twitterService: TwitterService;
  private openaiService: OpenAIService;
  private readonly supportedExtensions = ['.md', '.txt', '.json', '.yml', '.yaml'];

  constructor() {
    this.githubService = new GitHubService();
    this.twitterService = new TwitterService();
    this.openaiService = new OpenAIService();
  }

  async handleInteraction(interaction: Interaction): Promise<void> {
    if (!interaction.isCommand()) return;

    const { commandName } = interaction;

    if (commandName === 'issue') {
      await this.handleIssueTextCommand(interaction as ChatInputCommandInteraction);
    } else if (commandName === 'insert') {
      await this.handleInsertCommand(interaction as ChatInputCommandInteraction);
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
}
