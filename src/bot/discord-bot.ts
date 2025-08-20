import { Client, GatewayIntentBits, Events, Interaction, Partials, MessageReaction, User } from 'discord.js';
import { Logger } from '../shared/logger';
import { ErrorHandler } from '../shared/error-handler';
import { Metrics } from '../shared/metrics';
import { MessageHandler } from './handlers/message';
import { InteractionHandler } from './handlers/interaction-handler';
import { ReactionHandler } from './handlers/reaction-handler';
import { syncSlashCommands } from './command-registry';

export class DiscordBot {
  private client: Client;
  private messageHandler: MessageHandler;
  private interactionHandler: InteractionHandler;
  private reactionHandler: ReactionHandler;

  constructor() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
      ],
      partials: [Partials.Message, Partials.Channel, Partials.Reaction],
    });

    this.messageHandler = new MessageHandler();
    this.interactionHandler = new InteractionHandler();
    this.reactionHandler = new ReactionHandler();
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.client.once(Events.ClientReady, (readyClient) => {
      Logger.info(`Discord bot is ready! Logged in as ${readyClient.user.tag}`);
      Metrics.setActiveConnections('discord', 1);
      // Auto-sync slash commands unless explicitly disabled
      if ((process.env.COMMAND_AUTO_REGISTER || 'true').toLowerCase() !== 'false') {
        syncSlashCommands().catch(err => Logger.error('Command sync failed', err as Error));
      }
    });

    this.client.on(Events.MessageCreate, async (message) => {
      try {
        await this.messageHandler.handleMessage(message);
      } catch (error) {
        const guildId = message.guild?.id;
        const context = {
          channelId: message.channel.id,
          userId: message.author.id,
          operation: 'message_handling',
          ...(guildId ? { guildId } : {}),
        };
        await ErrorHandler.handleError(error as Error, context);
      }
    });

    this.client.on(Events.InteractionCreate, async (interaction: Interaction) => {
      try {
        await this.interactionHandler.handleInteraction(interaction);
      } catch (error) {
        const guildId = interaction.guild?.id;
        const channelId = interaction.channelId;
        const context = {
          userId: interaction.user.id,
          operation: 'interaction_handling',
          ...(guildId ? { guildId } : {}),
          ...(channelId ? { channelId } : {}),
        };
        await ErrorHandler.handleError(error as Error, context);
      }
    });

    this.client.on(Events.MessageReactionAdd, async (reaction, user) => {
      if (reaction.partial) {
        try {
          await reaction.fetch();
        } catch (error) {
          Logger.error('Failed to fetch partial reaction', error as Error);
          return;
        }
      }
      try {
        await this.reactionHandler.handleReaction(reaction as MessageReaction, user as User);
      } catch (error) {
        const guildId = reaction.message.guild?.id;
        const context = {
          userId: user.id,
          operation: 'reaction_handling',
          channelId: reaction.message.channel.id,
          ...(guildId ? { guildId } : {}),
        };
        await ErrorHandler.handleError(error as Error, context);
      }
    });

    this.client.on(Events.Error, (error) => {
      Logger.error('Discord client error', error);
      Metrics.setActiveConnections('discord', 0);
    });

    this.client.on('disconnect' as any, () => {
      Logger.warn('Discord client disconnected');
      Metrics.setActiveConnections('discord', 0);
    });

    this.client.on('reconnecting' as any, () => {
      Logger.info('Discord client reconnecting');
    });
  }

  async start(): Promise<void> {
    const token = process.env.DISCORD_BOT_TOKEN;
    
    if (!token) {
      throw new Error('DISCORD_BOT_TOKEN environment variable is required');
    }

    try {
      Logger.info('Starting Discord bot...');
      await this.client.login(token);
      Logger.info('Discord bot started successfully');
      
      // デバッグ用：定期的な生存確認
      setInterval(() => {
        Logger.info('Discord bot heartbeat - still alive', {
          ready: this.client.isReady(),
          wsStatus: this.client.ws.status,
          uptime: process.uptime()
        });
      }, 30000); // 30秒ごと
      
    } catch (error) {
      Logger.error('Failed to start Discord bot', error as Error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    try {
      Logger.info('Stopping Discord bot...');
      this.client.destroy();
      Metrics.setActiveConnections('discord', 0);
      Logger.info('Discord bot stopped successfully');
    } catch (error) {
      Logger.error('Failed to stop Discord bot', error as Error);
      throw error;
    }
  }

  isReady(): boolean {
    return this.client.isReady();
  }

  getGuildCount(): number {
    return this.client.guilds.cache.size;
  }

  async healthCheck(): Promise<boolean> {
    try {
      return this.client.isReady() && this.client.ws.status === 0; // 0 = READY
    } catch (error) {
      Logger.error('Discord health check failed', error as Error);
      return false;
    }
  }
}
