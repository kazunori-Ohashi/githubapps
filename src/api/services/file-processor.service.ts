import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../../shared/logger';
import { ExternalServiceError } from '../../shared/error-handler';

export interface FileProcessingResult {
  content: string;
  type: 'text';
  originalName: string;
  size: number;
}

export class FileProcessorService {
  private readonly supportedTextExtensions = ['.txt', '.md'];

  constructor() {
    // FFmpegのパスを設定（必要に応じて）
    // ffmpeg.setFfmpegPath('/usr/local/bin/ffmpeg');
  }

  async processFile(filePath: string, originalName: string, size: number): Promise<FileProcessingResult> {
    const extension = path.extname(originalName).toLowerCase();
    
    try {
      Logger.info(`Processing file`, {
        fileName: originalName,
        fileSize: size,
        extension
      });

      if (this.supportedTextExtensions.includes(extension)) {
        return await this.processTextFile(filePath, originalName, size);
      } else {
        throw new ExternalServiceError('FileProcessor', `Unsupported file type: ${extension}. Supported types: ${this.supportedTextExtensions.join(', ')}`);
      }
    } catch (error) {
      Logger.error(`File processing failed`, error as Error, {
        fileName: originalName,
        extension
      });
      throw error;
    }
  }

  private async processTextFile(filePath: string, originalName: string, size: number): Promise<FileProcessingResult> {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    return {
      content,
      type: 'text',
      originalName,
      size
    };
  }



  getSupportedExtensions(): string[] {
    return this.supportedTextExtensions;
  }

  isSupportedFile(fileName: string): boolean {
    const extension = path.extname(fileName).toLowerCase();
    return this.getSupportedExtensions().includes(extension);
  }
} 