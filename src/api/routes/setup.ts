import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Logger } from '../../shared/logger';
import { ErrorHandler, ValidationError, NotFoundError } from '../../shared/error-handler';
import { Metrics } from '../../shared/metrics';
import { FileUtils } from '../../shared/file-utils';
import { GuildMapping } from '../../shared/types';

interface CreateMappingRequest {
  guild_id: string;
  guild_name: string;
  installation_id: number;
  default_repo: {
    owner: string;
    name: string;
  };
  channels?: Array<{
    channel_id: string;
    channel_name: string;
    repo_override?: {
      owner: string;
      name: string;
    };
  }>;
}

interface UpdateMappingRequest extends Partial<CreateMappingRequest> {
  guild_id: string;
}

export async function setupRoutes(fastify: FastifyInstance): Promise<void> {
  
  // Get guild mapping
  fastify.get('/guild/:guildId', async (request: FastifyRequest, reply: FastifyReply) => {
    const startTime = Date.now();
    
    try {
      const { guildId } = request.params as { guildId: string };
      
      if (!guildId) {
        throw new ValidationError('Guild ID is required');
      }

      Logger.info(`Getting guild mapping`, { guildId });

      const mapping = await FileUtils.getGuildMapping(guildId);
      
      if (!mapping) {
        throw new NotFoundError('Guild mapping not found');
      }

      const duration = (Date.now() - startTime) / 1000;
      Metrics.recordHttpRequest('GET', '/api/setup/guild/:guildId', 200, duration);

      reply.code(200).send({
        status: 'success',
        data: mapping
      });

    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      const statusCode = ErrorHandler.getStatusCode(error as Error);
      
      Metrics.recordHttpRequest('GET', '/api/setup/guild/:guildId', statusCode, duration);

      Logger.error(`Failed to get guild mapping`, error as Error, {
        guildId: (request.params as any).guildId
      });

      reply.code(statusCode).send({
        error: ErrorHandler.getErrorMessage(error as Error)
      });
    }
  });

  // Create guild mapping
  fastify.post('/guild', async (request: FastifyRequest, reply: FastifyReply) => {
    const startTime = Date.now();
    
    try {
      const body = request.body as CreateMappingRequest;
      
      // Validate required fields
      if (!body.guild_id || !body.guild_name || !body.installation_id || !body.default_repo) {
        throw new ValidationError('Missing required fields: guild_id, guild_name, installation_id, default_repo');
      }

      if (!body.default_repo.owner || !body.default_repo.name) {
        throw new ValidationError('default_repo must have owner and name');
      }

      Logger.info(`Creating guild mapping`, {
        guildId: body.guild_id,
        installationId: body.installation_id,
        defaultRepo: `${body.default_repo.owner}/${body.default_repo.name}`
      });

      // Check if installation exists
      const installation = await FileUtils.getInstallation(body.installation_id);
      if (!installation) {
        throw new NotFoundError('GitHub App installation not found');
      }

      // Check if guild mapping already exists
      const existingMapping = await FileUtils.getGuildMapping(body.guild_id);
      if (existingMapping) {
        throw new ValidationError('Guild mapping already exists. Use PUT to update.');
      }

      const mapping: GuildMapping = {
        guild_id: body.guild_id,
        guild_name: body.guild_name,
        installation_id: body.installation_id,
        default_repo: body.default_repo,
        channels: body.channels || [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      await FileUtils.saveGuildMapping(mapping);

      const duration = (Date.now() - startTime) / 1000;
      Metrics.recordHttpRequest('POST', '/api/setup/guild', 201, duration);

      reply.code(201).send({
        status: 'success',
        message: 'Guild mapping created successfully',
        data: mapping
      });

    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      const statusCode = ErrorHandler.getStatusCode(error as Error);
      
      Metrics.recordHttpRequest('POST', '/api/setup/guild', statusCode, duration);

      Logger.error(`Failed to create guild mapping`, error as Error, {
        body: request.body
      });

      reply.code(statusCode).send({
        error: ErrorHandler.getErrorMessage(error as Error)
      });
    }
  });

  // Update guild mapping
  fastify.put('/guild/:guildId', async (request: FastifyRequest, reply: FastifyReply) => {
    const startTime = Date.now();
    
    try {
      const { guildId } = request.params as { guildId: string };
      const body = request.body as UpdateMappingRequest;

      if (!guildId) {
        throw new ValidationError('Guild ID is required');
      }

      Logger.info(`Updating guild mapping`, { guildId });

      const existingMapping = await FileUtils.getGuildMapping(guildId);
      if (!existingMapping) {
        throw new NotFoundError('Guild mapping not found');
      }

      // Validate installation if provided
      if (body.installation_id && body.installation_id !== existingMapping.installation_id) {
        const installation = await FileUtils.getInstallation(body.installation_id);
        if (!installation) {
          throw new NotFoundError('GitHub App installation not found');
        }
      }

      const updatedMapping: GuildMapping = {
        ...existingMapping,
        ...body,
        guild_id: guildId, // Ensure guild_id doesn't change
        updated_at: new Date().toISOString()
      };

      await FileUtils.saveGuildMapping(updatedMapping);

      const duration = (Date.now() - startTime) / 1000;
      Metrics.recordHttpRequest('PUT', '/api/setup/guild/:guildId', 200, duration);

      reply.code(200).send({
        status: 'success',
        message: 'Guild mapping updated successfully',
        data: updatedMapping
      });

    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      const statusCode = ErrorHandler.getStatusCode(error as Error);
      
      Metrics.recordHttpRequest('PUT', '/api/setup/guild/:guildId', statusCode, duration);

      Logger.error(`Failed to update guild mapping`, error as Error, {
        guildId: (request.params as any).guildId,
        body: request.body
      });

      reply.code(statusCode).send({
        error: ErrorHandler.getErrorMessage(error as Error)
      });
    }
  });

  // Delete guild mapping
  fastify.delete('/guild/:guildId', async (request: FastifyRequest, reply: FastifyReply) => {
    const startTime = Date.now();
    
    try {
      const { guildId } = request.params as { guildId: string };

      if (!guildId) {
        throw new ValidationError('Guild ID is required');
      }

      Logger.info(`Deleting guild mapping`, { guildId });

      const existingMapping = await FileUtils.getGuildMapping(guildId);
      if (!existingMapping) {
        throw new NotFoundError('Guild mapping not found');
      }

      await FileUtils.deleteGuildMapping(guildId);

      const duration = (Date.now() - startTime) / 1000;
      Metrics.recordHttpRequest('DELETE', '/api/setup/guild/:guildId', 200, duration);

      reply.code(200).send({
        status: 'success',
        message: 'Guild mapping deleted successfully'
      });

    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      const statusCode = ErrorHandler.getStatusCode(error as Error);
      
      Metrics.recordHttpRequest('DELETE', '/api/setup/guild/:guildId', statusCode, duration);

      Logger.error(`Failed to delete guild mapping`, error as Error, {
        guildId: (request.params as any).guildId
      });

      reply.code(statusCode).send({
        error: ErrorHandler.getErrorMessage(error as Error)
      });
    }
  });

  // List all installations
  fastify.get('/installations', async (request: FastifyRequest, reply: FastifyReply) => {
    const startTime = Date.now();
    
    try {
      Logger.info(`Listing installations`);

      // This is a simple implementation - in production you might want pagination
      const installations = [];
      
      // Read all installation files
      const fs = await import('fs/promises');
      const path = await import('path');
      
      try {
        const installationsDir = path.join(process.env.DATA_PATH || './data', 'installations');
        const files = await fs.readdir(installationsDir);
        
        for (const file of files) {
          if (file.endsWith('.yml')) {
            const installationId = parseInt(file.replace('.yml', ''));
            const installation = await FileUtils.getInstallation(installationId);
            if (installation) {
              installations.push(installation);
            }
          }
        }
      } catch (error) {
        // Directory might not exist yet
        Logger.debug('Installations directory not found or empty');
      }

      const duration = (Date.now() - startTime) / 1000;
      Metrics.recordHttpRequest('GET', '/api/setup/installations', 200, duration);

      reply.code(200).send({
        status: 'success',
        data: {
          installations,
          count: installations.length
        }
      });

    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      const statusCode = ErrorHandler.getStatusCode(error as Error);
      
      Metrics.recordHttpRequest('GET', '/api/setup/installations', statusCode, duration);

      Logger.error(`Failed to list installations`, error as Error);

      reply.code(statusCode).send({
        error: ErrorHandler.getErrorMessage(error as Error)
      });
    }
  });

  // Health check for setup service
  fastify.get('/health', async (request: FastifyRequest, reply: FastifyReply) => {
    const startTime = Date.now();
    
    try {
      const duration = (Date.now() - startTime) / 1000;
      Metrics.recordHttpRequest('GET', '/api/setup/health', 200, duration);

      reply.code(200).send({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'setup'
      });

    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      Metrics.recordHttpRequest('GET', '/api/setup/health', 500, duration);

      reply.code(500).send({
        status: 'error',
        error: ErrorHandler.getErrorMessage(error as Error)
      });
    }
  });
}