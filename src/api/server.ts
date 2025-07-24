import Fastify, { FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import { Logger } from '../shared/logger';
import { ErrorHandler } from '../shared/error-handler';
import { Metrics } from '../shared/metrics';
import { webhookRoutes } from './routes/webhooks';
import { setupRoutes } from './routes/setup';

export class APIServer {
  private app: FastifyInstance;
  private port: number;

  constructor(port: number = 3000) {
    this.port = port;
    this.app = Fastify({
      logger: false, // We use our custom logger
      trustProxy: true,
      bodyLimit: 1048576 * 10, // 10MB
    });

    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  private setupMiddleware(): void {
    // Security headers
    this.app.register(helmet, {
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
        },
      },
    });

    // CORS
    this.app.register(cors, {
      origin: process.env.ALLOWED_ORIGINS?.split(',') || false,
      credentials: true,
    });

    // Request logging
    this.app.addHook('preHandler', async (request, reply) => {
      Logger.debug(`${request.method} ${request.url}`, {
        ip: request.ip,
        userAgent: request.headers['user-agent']
      });
    });

    // Response logging
    this.app.addHook('onResponse', async (request, reply) => {
      Logger.info(`${request.method} ${request.url} - ${reply.statusCode}`, {
        ip: request.ip,
        responseTime: reply.elapsedTime
      });
    });
  }

  private setupRoutes(): void {
    // Health check
    this.app.get('/health', async (request, reply) => {
      const startTime = Date.now();
      
      try {
        const duration = (Date.now() - startTime) / 1000;
        Metrics.recordHttpRequest('GET', '/health', 200, duration);

        reply.send({
          status: 'healthy',
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
          version: process.env.npm_package_version || '1.0.0'
        });
      } catch (error) {
        const duration = (Date.now() - startTime) / 1000;
        Metrics.recordHttpRequest('GET', '/health', 500, duration);
        
        reply.code(500).send({
          status: 'error',
          error: ErrorHandler.getErrorMessage(error as Error)
        });
      }
    });

    // Metrics endpoint
    this.app.get('/metrics', async (request, reply) => {
      try {
        const metrics = await Metrics.getMetrics();
        reply.type('text/plain').send(metrics);
      } catch (error) {
        Logger.error('Failed to get metrics', error as Error);
        reply.code(500).send({
          error: 'Failed to retrieve metrics'
        });
      }
    });

    // API routes
    this.app.register(webhookRoutes, { prefix: '/webhooks' });
    this.app.register(setupRoutes, { prefix: '/api/setup' });

    // 404 handler
    this.app.setNotFoundHandler(async (request, reply) => {
      const duration = 0; // Not meaningful for 404s
      Metrics.recordHttpRequest(request.method, request.url, 404, duration);
      
      reply.code(404).send({
        error: 'Not Found',
        message: `Route ${request.method} ${request.url} not found`
      });
    });
  }

  private setupErrorHandling(): void {
    this.app.setErrorHandler(async (error, request, reply) => {
      const statusCode = ErrorHandler.getStatusCode(error);
      const duration = reply.elapsedTime || 0;
      
      Metrics.recordHttpRequest(request.method, request.url, statusCode, duration);

      await ErrorHandler.handleError(error, {
        operation: 'api_request'
      });

      reply.code(statusCode).send({
        error: ErrorHandler.getErrorMessage(error),
        statusCode,
        timestamp: new Date().toISOString()
      });
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
      Logger.info('SIGTERM received, shutting down gracefully');
      this.stop();
    });

    process.on('SIGINT', () => {
      Logger.info('SIGINT received, shutting down gracefully');
      this.stop();
    });
  }

  async start(): Promise<void> {
    try {
      Logger.info(`Starting API server on port ${this.port}...`);
      
      await this.app.listen({ 
        port: this.port, 
        host: '0.0.0.0' 
      });
      
      Logger.info(`API server started successfully on port ${this.port}`);
      
      Metrics.setActiveConnections('api', 1);
      
    } catch (error) {
      Logger.error('Failed to start API server', error as Error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    try {
      Logger.info('Stopping API server...');
      
      await this.app.close();
      
      Logger.info('API server stopped successfully');
      
      Metrics.setActiveConnections('api', 0);
      
    } catch (error) {
      Logger.error('Failed to stop API server', error as Error);
      throw error;
    }
  }

  get instance(): FastifyInstance {
    return this.app;
  }

  async healthCheck(): Promise<boolean> {
    try {
      // Simple check if server is listening
      return this.app.server.listening;
    } catch (error) {
      Logger.error('API server health check failed', error as Error);
      return false;
    }
  }
}