import 'dotenv/config';
import { Logger } from './shared/logger';
import { ErrorHandler } from './shared/error-handler';
import { DiscordBot } from './bot/discord-bot';
import { APIServer } from './api/server';

class Application {
  private discordBot: DiscordBot;
  private apiServer: APIServer;

  constructor() {
    this.validateEnvironment();
    
    this.discordBot = new DiscordBot();
    this.apiServer = new APIServer(parseInt(process.env.PORT || '3000'));
    
    this.setupGracefulShutdown();
  }

  private validateEnvironment(): void {
    const requiredEnvVars = [
      'DISCORD_BOT_TOKEN',
      'GITHUB_APP_ID',
      'GITHUB_APP_PRIVATE_KEY',
      'GITHUB_WEBHOOK_SECRET',
      'OPENAI_API_KEY'
    ];

    const missingVars = requiredEnvVars.filter(envVar => !process.env[envVar]);
    
    if (missingVars.length > 0) {
      throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
    }

    Logger.info('Environment validation passed');
  }

  async start(): Promise<void> {
    try {
      Logger.info('Starting Discord-GitHub Integration Bot...');
      Logger.info(`GITHUB_APP_ID at startup: ${process.env.GITHUB_APP_ID}`);

      // Start services in parallel - API Server temporarily disabled for debugging
      await Promise.all([
        this.startDiscordBot(),
        this.startAPIServer()  // ← コメントアウト解除
      ]);

      Logger.info('Discord Bot started successfully (API Server disabled for debugging)');
      
      // Log application status
      this.logStatus();

    } catch (error) {
      Logger.error('Failed to start application', error as Error);
      await this.stop();
      process.exit(1);
    }
  }

  private async startDiscordBot(): Promise<void> {
    try {
      await this.discordBot.start();
      Logger.info('Discord bot started');
    } catch (error) {
      Logger.error('Failed to start Discord bot', error as Error);
      throw error;
    }
  }

  private async startAPIServer(): Promise<void> {
    try {
      await this.apiServer.start();
      Logger.info('API server started');
    } catch (error) {
      Logger.error('Failed to start API server', error as Error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    Logger.info('Stopping application...');

    const shutdownPromises = [];

    if (this.discordBot) {
      shutdownPromises.push(
        this.discordBot.stop().catch(error => 
          Logger.error('Error stopping Discord bot', error)
        )
      );
    }

    if (this.apiServer) {
      shutdownPromises.push(
        this.apiServer.stop().catch(error => 
          Logger.error('Error stopping API server', error)
        )
      );
    }

    await Promise.all(shutdownPromises);
    
    Logger.info('Application stopped');
  }

  private setupGracefulShutdown(): void {
    const shutdown = async (signal: string) => {
      Logger.info(`Received ${signal}, initiating graceful shutdown...`);
      
      try {
        await this.stop();
        process.exit(0);
      } catch (error) {
        Logger.error('Error during shutdown', error as Error);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    process.on('uncaughtException', async (error) => {
      Logger.error('Uncaught exception', error);
      await ErrorHandler.handleError(error);
      process.exit(1);
    });

    process.on('unhandledRejection', async (reason, promise) => {
      Logger.error('Unhandled promise rejection', reason as Error, { promise });
      await ErrorHandler.handleError(reason as Error);
    });
  }

  private logStatus(): void {
    Logger.info('Application Status:', {
      discordBot: {
        ready: this.discordBot.isReady(),
        guildCount: this.discordBot.getGuildCount()
      },
      apiServer: {
        healthy: this.apiServer.healthCheck()
      },
      environment: process.env.NODE_ENV,
      version: process.env.npm_package_version || '1.0.0',
      uptime: process.uptime()
    });
  }

  async healthCheck(): Promise<{
    status: 'healthy' | 'unhealthy';
    services: Record<string, boolean>;
  }> {
    const services = {
      discord: await this.discordBot.healthCheck(),
      api: await this.apiServer.healthCheck()
    };

    const allHealthy = Object.values(services).every(healthy => healthy);

    return {
      status: allHealthy ? 'healthy' : 'unhealthy',
      services
    };
  }
}

// Start the application
async function main() {
  try {
    const app = new Application();
    await app.start();
  } catch (error) {
    Logger.error('Failed to start application', error as Error);
    process.exit(1);
  }
}

// Only run if this file is executed directly
if (require.main === module) {
  main();
}

export { Application };