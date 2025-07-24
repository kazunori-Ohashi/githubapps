import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import { Logger } from '../../shared/logger';
import { ErrorHandler, UnauthorizedError } from '../../shared/error-handler';
import { Metrics } from '../../shared/metrics';
import { GitHubService } from '../services/github.service';

interface WebhookPayload {
  action: string;
  installation?: {
    id: number;
    account: any;
    app_id: number;
    permissions: any;
    created_at: string;
    updated_at: string;
  };
  repositories?: any[];
}

export async function webhookRoutes(fastify: FastifyInstance): Promise<void> {
  const githubService = new GitHubService();

  fastify.post('/github', async (request: FastifyRequest, reply: FastifyReply) => {
    const startTime = Date.now();
    
    try {
      // Verify webhook signature
      const signature = request.headers['x-hub-signature-256'] as string;
      const payload = JSON.stringify(request.body);
      
      if (!verifyGitHubSignature(payload, signature)) {
        throw new UnauthorizedError('Invalid webhook signature');
      }

      const event = request.headers['x-github-event'] as string;
      const deliveryId = request.headers['x-github-delivery'] as string;

      Logger.info(`Received GitHub webhook`, {
        event,
        deliveryId,
        action: (request.body as WebhookPayload).action
      });

      await handleWebhookEvent(event, request.body as WebhookPayload, githubService);

      const duration = (Date.now() - startTime) / 1000;
      Metrics.recordHttpRequest('POST', '/webhooks/github', 200, duration);

      reply.code(200).send({ status: 'success' });

    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      const statusCode = ErrorHandler.getStatusCode(error as Error);
      
      Metrics.recordHttpRequest('POST', '/webhooks/github', statusCode, duration);

      Logger.error(`Webhook processing failed`, error as Error, {
        event: request.headers['x-github-event'],
        deliveryId: request.headers['x-github-delivery']
      });

      reply.code(statusCode).send({
        error: ErrorHandler.getErrorMessage(error as Error)
      });
    }
  });

  // Health check endpoint
  fastify.get('/health', async (request: FastifyRequest, reply: FastifyReply) => {
    const startTime = Date.now();
    
    try {
      const isHealthy = await githubService.healthCheck();
      const duration = (Date.now() - startTime) / 1000;
      
      const statusCode = isHealthy ? 200 : 503;
      Metrics.recordHttpRequest('GET', '/webhooks/health', statusCode, duration);
      
      reply.code(statusCode).send({
        status: isHealthy ? 'healthy' : 'unhealthy',
        timestamp: new Date().toISOString(),
        checks: {
          github: isHealthy
        }
      });

    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      Metrics.recordHttpRequest('GET', '/webhooks/health', 500, duration);
      
      reply.code(500).send({
        status: 'error',
        error: ErrorHandler.getErrorMessage(error as Error)
      });
    }
  });
}

function verifyGitHubSignature(payload: string, signature: string): boolean {
  if (!signature) {
    return false;
  }

  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    Logger.error('GITHUB_WEBHOOK_SECRET not configured');
    return false;
  }

  const expectedSignature = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(payload, 'utf8')
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

async function handleWebhookEvent(
  event: string,
  payload: WebhookPayload,
  githubService: GitHubService
): Promise<void> {
  switch (event) {
    case 'installation':
      await handleInstallationEvent(payload, githubService);
      break;
    
    case 'installation_repositories':
      await handleInstallationRepositoriesEvent(payload, githubService);
      break;
    
    case 'ping':
      Logger.info('Received ping webhook');
      break;
    
    default:
      Logger.debug(`Unhandled webhook event: ${event}`, { action: payload.action });
  }
}

async function handleInstallationEvent(
  payload: WebhookPayload,
  githubService: GitHubService
): Promise<void> {
  const { action, installation } = payload;
  
  if (!installation) {
    throw new Error('Installation data missing from webhook payload');
  }

  switch (action) {
    case 'created':
      Logger.info(`GitHub App installed`, {
        installationId: installation.id,
        account: installation.account.login
      });
      
      await githubService.handleInstallationCreated(installation.id, payload);
      break;

    case 'deleted':
      Logger.info(`GitHub App uninstalled`, {
        installationId: installation.id,
        account: installation.account.login
      });
      
      await githubService.handleInstallationDeleted(installation.id);
      break;

    case 'suspend':
      Logger.info(`GitHub App suspended`, {
        installationId: installation.id,
        account: installation.account.login
      });
      break;

    case 'unsuspend':
      Logger.info(`GitHub App unsuspended`, {
        installationId: installation.id,
        account: installation.account.login
      });
      break;

    default:
      Logger.debug(`Unhandled installation action: ${action}`);
  }
}

async function handleInstallationRepositoriesEvent(
  payload: WebhookPayload,
  githubService: GitHubService
): Promise<void> {
  const { action, installation } = payload;
  
  if (!installation) {
    throw new Error('Installation data missing from webhook payload');
  }

  switch (action) {
    case 'added':
      Logger.info(`Repositories added to installation`, {
        installationId: installation.id,
        repositoryCount: payload.repositories?.length || 0
      });
      
      // Update installation data with new repositories
      await githubService.handleInstallationCreated(installation.id, payload);
      break;

    case 'removed':
      Logger.info(`Repositories removed from installation`, {
        installationId: installation.id,
        repositoryCount: payload.repositories?.length || 0
      });
      
      // Update installation data
      await githubService.handleInstallationCreated(installation.id, payload);
      break;

    default:
      Logger.debug(`Unhandled installation_repositories action: ${action}`);
  }
}