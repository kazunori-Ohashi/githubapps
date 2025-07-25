import { Client, GatewayIntentBits, Events, Interaction } from 'discord.js';
import { Logger } from '../shared/logger';
import { ErrorHandler } from '../shared/error-handler';
import { Metrics } from '../shared/metrics';
import { MessageHandler } from './handlers/message';
import { InteractionHandler } from './handlers/interaction-handler';

export class DiscordBot {
  private client: Client;
  private messageHandler: MessageHandler;
  private interactionHandler: InteractionHandler;

  constructor() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    this.messageHandler = new MessageHandler();
    this.interactionHandler = new InteractionHandler();
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.client.once(Events.ClientReady, (readyClient) => {
      Logger.info(`Discord bot is ready! Logged in as ${readyClient.user.tag}`);
      Metrics.setActiveConnections('discord', 1);
    });

    this.client.on(Events.MessageCreate, async (message) => {
      try {
        await this.messageHandler.handleMessage(message);
      } catch (error) {
        const context: {
          guildId?: string;
          channelId?: string;
          userId?: string;
          operation?: string;
        } = {
          channelId: message.channel.id,
          userId: message.author.id,
          operation: 'message_handling'
        };
        
        if (message.guild?.id) {
          context.guildId = message.guild.id;
        }
        
        await ErrorHandler.handleError(error as Error, context);
      }
    });

    this.client.on(Events.InteractionCreate, async (interaction: Interaction) => {
      try {
        await this.interactionHandler.handleInteraction(interaction);
      } catch (error) {
        const context: {
          guildId?: string;
          channelId?: string;
          userId?: string;
          operation?: string;
        } = {
          userId: interaction.user.id,
          operation: 'interaction_handling',
        };

        if (interaction.guild?.id) {
          context.guildId = interaction.guild.id;
        }
        if (interaction.channelId) {
          context.channelId = interaction.channelId;
        }

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