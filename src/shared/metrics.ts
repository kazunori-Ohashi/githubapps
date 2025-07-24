import { register, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

collectDefaultMetrics({
  prefix: 'discord_github_bot_',
  gcDurationBuckets: [0.001, 0.01, 0.1, 1, 2, 5],
});

export const httpRequestsTotal = new Counter({
  name: 'discord_github_bot_http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
});

export const httpRequestDuration = new Histogram({
  name: 'discord_github_bot_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route'],
  buckets: [0.1, 0.5, 1, 2, 5, 10],
});

export const discordMessagesProcessed = new Counter({
  name: 'discord_github_bot_discord_messages_processed_total',
  help: 'Total number of Discord messages processed',
  labelNames: ['guild_id', 'status'],
});

export const githubApiCalls = new Counter({
  name: 'discord_github_bot_github_api_calls_total',
  help: 'Total number of GitHub API calls',
  labelNames: ['endpoint', 'status'],
});

export const openaiApiCalls = new Counter({
  name: 'discord_github_bot_openai_api_calls_total',
  help: 'Total number of OpenAI API calls',
  labelNames: ['model', 'status'],
});

export const fileProcessingDuration = new Histogram({
  name: 'discord_github_bot_file_processing_duration_seconds',
  help: 'File processing duration in seconds',
  labelNames: ['file_type'],
  buckets: [0.5, 1, 2, 5, 10, 30, 60],
});

export const activeConnections = new Gauge({
  name: 'discord_github_bot_active_connections',
  help: 'Number of active connections',
  labelNames: ['type'],
});

export const operationErrors = new Counter({
  name: 'discord_github_bot_operation_errors_total',
  help: 'Total number of operation errors',
  labelNames: ['operation', 'error_type'],
});

export const memoryUsage = new Gauge({
  name: 'discord_github_bot_memory_usage_bytes',
  help: 'Memory usage in bytes',
  labelNames: ['type'],
});

export const fileOperations = new Counter({
  name: 'discord_github_bot_file_operations_total',
  help: 'Total number of file operations',
  labelNames: ['operation', 'status'],
});

export class Metrics {
  static recordHttpRequest(method: string, route: string, statusCode: number, duration: number): void {
    httpRequestsTotal.inc({ method, route, status_code: statusCode.toString() });
    httpRequestDuration.observe({ method, route }, duration);
  }

  static recordDiscordMessage(guildId: string, status: 'success' | 'error'): void {
    discordMessagesProcessed.inc({ guild_id: guildId, status });
  }

  static recordGitHubApiCall(endpoint: string, status: 'success' | 'error'): void {
    githubApiCalls.inc({ endpoint, status });
  }

  static recordOpenAIApiCall(model: string, status: 'success' | 'error'): void {
    openaiApiCalls.inc({ model, status });
  }

  static recordFileProcessing(fileType: string, duration: number): void {
    fileProcessingDuration.observe({ file_type: fileType }, duration);
  }

  static setActiveConnections(type: string, count: number): void {
    activeConnections.set({ type }, count);
  }

  static recordOperationError(operation: string, errorType: string): void {
    operationErrors.inc({ operation, error_type: errorType });
  }

  static updateMemoryUsage(): void {
    const usage = process.memoryUsage();
    memoryUsage.set({ type: 'rss' }, usage.rss);
    memoryUsage.set({ type: 'heap_used' }, usage.heapUsed);
    memoryUsage.set({ type: 'heap_total' }, usage.heapTotal);
    memoryUsage.set({ type: 'external' }, usage.external);
  }

  static recordFileOperation(operation: string, status: 'success' | 'error'): void {
    fileOperations.inc({ operation, status });
  }

  static async getMetrics(): Promise<string> {
    return register.metrics();
  }

  static clearMetrics(): void {
    register.clear();
  }
}

setInterval(() => {
  Metrics.updateMemoryUsage();
}, 30000);