
import { Interaction, CommandInteraction, Attachment, CacheType, ChatInputCommandInteraction } from 'discord.js';
import { Logger } from '../../shared/logger';
import { ErrorHandler, ValidationError } from '../../shared/error-handler';
import { Metrics } from '../../shared/metrics';
import { GitHubService } from '../../api/services/github.service';
import { TwitterService } from '../../api/services/twitter.service';
import { ProcessedFile } from '../../shared/types';

export class InteractionHandler {
  private githubService: GitHubService;
  private twitterService: TwitterService;
  private readonly supportedExtensions = ['.md', '.txt', '.json', '.yml', '.yaml'];

  constructor() {
    this.githubService = new GitHubService();
    this.twitterService = new TwitterService();
  }

  async handleInteraction(interaction: Interaction): Promise<void> {
    if (!interaction.isCommand()) return;

    const { commandName } = interaction;

    if (commandName === 'issue') {
      await this.handleIssueCommand(interaction as ChatInputCommandInteraction);
    }
  }

  private async handleIssueCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      if (!interaction.guild) {
        throw new ValidationError('This command can only be used in a server.');
      }

      const mode = interaction.options.getString('mode', true);
      let processedFile: ProcessedFile;

      if (mode === 'file') {
        const attachment = interaction.options.getAttachment('file', true);
        this.validateFile(attachment);
        processedFile = await this.downloadAndProcessFile(attachment);
      } else if (mode === 'text') {
        const content = interaction.options.getString('content', true);
        processedFile = {
          original_name: `issue-from-text.md`,
          content: content,
          size: Buffer.byteLength(content, 'utf-8'),
          type: 'markdown'
        };
      } else {
        throw new ValidationError("Unsupported mode. Choose 'file' or 'text'.");
      }

      await interaction.deferReply();

      const result = await this.githubService.processFileUpload(
        interaction.guild.id,
        interaction.channelId,
        interaction.user.id,
        processedFile
      );

      await interaction.editReply(`✅ Issue created: ${result.url}`);
      Metrics.recordDiscordMessage(interaction.guild.id, 'success');

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
      Metrics.recordDiscordMessage(interaction.guild?.id || 'unknown', 'error');
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
