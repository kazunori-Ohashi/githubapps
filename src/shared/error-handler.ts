import { Logger } from './logger';
import { FileUtils } from './file-utils';
import { OperationLog } from './types';

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly context?: Record<string, any> | undefined;

  constructor(
    message: string,
    statusCode: number = 500,
    isOperational: boolean = true,
    context?: Record<string, any> | undefined
  ) {
    super(message);
    
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.context = context;

    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, 400, true, context);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, 404, true, context);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, 401, true, context);
  }
}

export class ExternalServiceError extends AppError {
  constructor(service: string, message: string, context?: Record<string, any>) {
    super(`${service} service error: ${message}`, 502, true, {
      service,
      ...context
    });
  }
}

export class ErrorHandler {
  static async handleError(error: Error, context?: {
    guildId?: string;
    channelId?: string;
    userId?: string;
    operation?: string;
  }): Promise<void> {
    const isAppError = error instanceof AppError;
    
    Logger.error(
      `${isAppError ? 'Application' : 'Unexpected'} error occurred`,
      error,
      {
        statusCode: isAppError ? error.statusCode : 500,
        isOperational: isAppError ? error.isOperational : false,
        context: {
          ...context,
          ...(isAppError ? error.context : {})
        }
      }
    );

    if (context?.guildId && context?.operation) {
      try {
        const operationLog: OperationLog = {
          id: this.generateId(),
          timestamp: new Date().toISOString(),
          guild_id: context.guildId,
          channel_id: context.channelId || 'unknown',
          user_id: context.userId || 'unknown',
          operation_type: context.operation as any,
          status: 'error',
          details: {
            error_message: error.message
          }
        };

        await FileUtils.logOperation(operationLog);
      } catch (logError) {
        Logger.error('Failed to log operation error', logError as Error);
      }
    }

    if (!isAppError || !error.isOperational) {
      Logger.error('Non-operational error detected, application should be restarted');
      
      if (process.env.NODE_ENV === 'production') {
        process.exit(1);
      }
    }
  }

  static isTrustedError(error: Error): boolean {
    return error instanceof AppError && error.isOperational;
  }

  static getErrorMessage(error: Error): string {
    if (error instanceof AppError) {
      return error.message;
    }
    
    if (process.env.NODE_ENV === 'production') {
      return 'An unexpected error occurred';
    }
    
    return error.message;
  }

  static getStatusCode(error: Error): number {
    if (error instanceof AppError) {
      return error.statusCode;
    }
    
    return 500;
  }

  private static generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }
}

export const handleAsyncError = (fn: Function) => {
  return (...args: any[]) => {
    const result = fn(...args);
    if (result && typeof result.catch === 'function') {
      result.catch((error: Error) => {
        ErrorHandler.handleError(error);
      });
    }
    return result;
  };
};