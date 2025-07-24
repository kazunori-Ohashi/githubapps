import winston from 'winston';
import path from 'path';

const { combine, timestamp, printf, errors, colorize } = winston.format;

const logFormat = printf(({ level, message, timestamp, stack }) => {
  return `${timestamp} [${level}]: ${stack || message}`;
});

const createLogger = () => {
  const transports: winston.transport[] = [
    new winston.transports.Console({
      format: combine(
        colorize(),
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        errors({ stack: true }),
        logFormat
      ),
    }),
    // 開発環境でもファイル出力を有効化
    new winston.transports.File({
      filename: path.join(process.env.DATA_PATH || './data', 'logs', 'error.log'),
      level: 'error',
      format: combine(
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        errors({ stack: true }),
        logFormat
      ),
    }),
    new winston.transports.File({
      filename: path.join(process.env.DATA_PATH || './data', 'logs', 'combined.log'),
      format: combine(
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        errors({ stack: true }),
        logFormat
      ),
    })
  ];

  return winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: combine(
      timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      errors({ stack: true })
    ),
    transports,
    exitOnError: false,
  });
};

export const logger = createLogger();

export class Logger {
  static info(message: string, meta?: any): void {
    logger.info(message, meta);
  }

  static warn(message: string, meta?: any): void {
    logger.warn(message, meta);
  }

  static error(message: string, error?: Error, meta?: any): void {
    if (error) {
      logger.error(message, { error: error.stack, ...meta });
    } else {
      logger.error(message, meta);
    }
  }

  static debug(message: string, meta?: any): void {
    logger.debug(message, meta);
  }

  static verbose(message: string, meta?: any): void {
    logger.verbose(message, meta);
  }
}