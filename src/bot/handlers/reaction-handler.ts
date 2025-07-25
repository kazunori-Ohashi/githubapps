import { MessageReaction, User, PartialMessageReaction, PartialUser, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, InteractionType, MessageActionRowComponentBuilder, Events } from 'discord.js';
import { Logger } from '../../shared/logger';
import { ErrorHandler } from '../../shared/error-handler';
import { TwitterService } from '../../api/services/twitter.service';
import { Metrics } from '../../shared/metrics';

export class ReactionHandler {
  private twitterService: TwitterService;

  constructor() {
    this.twitterService = new TwitterService();
  }

  async handleReaction(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser): Promise<void> {
    // Ignore reactions from the bot itself
    if (user.bot) return;

    // We only care about the heart emoji
    if (reaction.emoji.name !== '❤️') return;

    // Ensure the message is fully fetched
    if (reaction.message.partial) {
      try {
        await reaction.message.fetch();
      } catch (error) {
        Logger.error('Failed to fetch partial message on reaction', error as Error);
        return;
      }
    }

    const message = reaction.message;

    // message.authorがnullの場合は何もしない
    if (!message.author) return;
    // We only care about reactions to our own messages
    if (message.author.id !== reaction.client.user?.id) return;

    Logger.info(`Processing ❤️ reaction`, {
      guildId: message.guild?.id,
      channelId: message.channel.id,
      userId: user.id,
      messageId: message.id,
    });

    try {
      let contentToTweet = '';

      // 1. Check for content in embeds
      if (message.embeds.length > 0) {
        const embed = message.embeds[0];
        if (embed) {
          // Heuristic: Combine title and description for tweet content
          if (embed.title) contentToTweet += embed.title + '\n';
          if (embed.description) contentToTweet += embed.description;
        }
      }

      // 2. If no embed content, check for attachments (e.g., markdown files)
      if (!contentToTweet && message.attachments.size > 0) {
        const attachment = message.attachments.first();
        if (attachment && (attachment.name.endsWith('.md') || attachment.name.endsWith('.txt'))) {
          const response = await fetch(attachment.url);
          contentToTweet = await response.text();
        }
      }

      if (!contentToTweet.trim()) {
        Logger.warn('Could not extract meaningful content to tweet from the message.');
        if (message.channel && 'send' in message.channel && typeof message.channel.send === 'function') {
          await message.channel.send({ content: 'Could not find content to tweet in the message.', reply: { messageReference: message.id } });
        }
        return;
      }

      // 140字超は要約
      let tweetText = contentToTweet;
      if (tweetText.length > 140) {
        tweetText = await this.twitterService.summarizeForTweet(tweetText);
      }
      const tweetUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}`;

      // 編集ボタン付きで本文を明示表示
      if (message.channel && 'send' in message.channel && typeof message.channel.send === 'function') {
        const row = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId('edit_tweet')
            .setLabel('編集')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setLabel('ツイート画面を開く')
            .setStyle(ButtonStyle.Link)
            .setURL(tweetUrl)
        );
        const sent = await message.channel.send({
          content: `✍️ ツイートプレビュー:
\n\`\`\`${tweetText}\`\`\``,
          components: [row],
          reply: { messageReference: message.id },
        });

        // ボタンのインタラクションリスナー
        const collector = sent.createMessageComponentCollector({
          filter: (i) => i.customId === 'edit_tweet' && i.user.id === user.id,
          time: 120000
        });
        collector.on('collect', async (interaction) => {
          // Modalで編集UIを表示
          const modal = new ModalBuilder()
            .setCustomId('tweet_modal')
            .setTitle('ツイート編集')
            .addComponents(
              new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                  .setCustomId('tweet_text')
                  .setLabel('ツイート本文（140字以内）')
                  .setStyle(TextInputStyle.Paragraph)
                  .setMaxLength(140)
                  .setValue(tweetText)
              )
            );
          await interaction.showModal(modal);

          // Modalのsubmitイベントはグローバルでlistenする必要がある
        });

        // Modal submitリスナー（グローバル）
        const client = message.client;
        if (!(client as any)._tweetModalListener) {
          client.on(Events.InteractionCreate, async (interaction) => {
            if (!interaction.isModalSubmit()) return;
            if (interaction.customId !== 'tweet_modal') return;
            const newText = interaction.fields.getTextInputValue('tweet_text');
            const url = await this.twitterService.createTweetIntentUrl(newText);
            await interaction.reply({
              content: `✍️ ツイートプレビュー（編集後）:\n\n${newText}\n[ツイート画面を開く](${url})`,
              ephemeral: true,
            });
          });
          (client as any)._tweetModalListener = true;
        }
      }
      Metrics.recordDiscordMessage(message.guild?.id || 'unknown', 'success');
    } catch (error) {
      const guildId = message.guild?.id;
      const context = {
        userId: user.id,
        operation: 'reaction_handling',
        channelId: message.channel.id,
        ...(guildId ? { guildId } : {}),
      };
      await ErrorHandler.handleError(error as Error, context);
      Metrics.recordDiscordMessage(message.guild?.id || 'unknown', 'error');
      if (message.channel && 'send' in message.channel && typeof message.channel.send === 'function') {
        await message.channel.send({ content: `❌ Failed to generate tweet link: ${ErrorHandler.getErrorMessage(error as Error)}`, reply: { messageReference: message.id } });
      }
    }
  }
}