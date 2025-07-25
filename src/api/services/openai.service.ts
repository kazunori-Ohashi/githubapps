import OpenAI from 'openai';
import { Logger } from '../../shared/logger';
import { ExternalServiceError } from '../../shared/error-handler';
import { Metrics } from '../../shared/metrics';
import { ProcessedFile } from '../../shared/types';
import * as fs from 'fs';
import * as yaml from 'js-yaml';

export interface SummarizationOptions {
  maxLength?: number;
  style?: 'brief' | 'detailed' | 'bullet-points';
  language?: 'ja' | 'en';
}

export class OpenAIService {
  private client: OpenAI;
  private prompts: any;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }

    this.client = new OpenAI({
      apiKey,
    });

    // Load prompts from YAML file
    this.loadPrompts();
  }

  private loadPrompts(): void {
    try {
      const promptsFile = fs.readFileSync('prompts.yaml', 'utf8');
      this.prompts = yaml.load(promptsFile);
    } catch (error) {
      Logger.error('Failed to load prompts.yaml', error as Error);
      throw new Error('Failed to load prompts configuration');
    }
  }

  async summarizeFile(
    file: ProcessedFile,
    options: SummarizationOptions = {}
  ): Promise<string> {
    const startTime = Date.now();
    
    try {
      Logger.info(`Starting file summarization`, {
        fileName: file.original_name,
        fileSize: file.size,
        fileType: file.type
      });

      const prompt = this.buildSummarizationPrompt(file, options);
      
      const response = await this.client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: this.getSystemPrompt(options)
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: this.getMaxTokens(options),
        temperature: 0.3,
      });

      const summary = response.choices[0]?.message?.content;
      
      if (!summary) {
        throw new ExternalServiceError('OpenAI', 'No summary generated');
      }

      const duration = (Date.now() - startTime) / 1000;
      
      Logger.info(`File summarization completed`, {
        fileName: file.original_name,
        summaryLength: summary.length,
        duration: `${duration}s`
      });

      Metrics.recordOpenAIApiCall('gpt-4o-mini', 'success');
      
      return summary.trim();
      
    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      
      Logger.error(`File summarization failed`, error as Error, {
        fileName: file.original_name,
        duration: `${duration}s`
      });

      Metrics.recordOpenAIApiCall('gpt-4o-mini', 'error');
      
      const errorAny = error as any;
      if (errorAny.status && errorAny.type) {
        throw new ExternalServiceError('OpenAI', `API Error: ${(error as Error).message}`, {
          status: errorAny.status,
          type: errorAny.type
        });
      }
      
      throw new ExternalServiceError('OpenAI', `Unexpected error: ${(error as Error).message}`);
    }
  }

  private getSystemPrompt(options: SummarizationOptions): string {
    const language = options.language || 'ja';
    const style = options.style || 'brief';

    return this.prompts.issue.system[language][style];
  }

  private buildSummarizationPrompt(file: ProcessedFile, options: SummarizationOptions): string {
    const language = options.language || 'ja';
    
    let promptTemplate = this.prompts.issue.user[language];
    
    // Replace placeholders
    promptTemplate = promptTemplate.replace('{original_name}', file.original_name);
    promptTemplate = promptTemplate.replace('{type}', file.type);
    promptTemplate = promptTemplate.replace('{size}', this.formatFileSize(file.size));
    promptTemplate = promptTemplate.replace('{content}', file.content);
    promptTemplate = promptTemplate.replace('{maxLength}', (options.maxLength || 500).toString());
    
    return promptTemplate;
  }

  private getMaxTokens(options: SummarizationOptions): number {
    const maxLength = options.maxLength || 500;
    
    // Rough estimation: 1 token ≈ 3-4 characters for Japanese, 4-5 for English
    const language = options.language || 'ja';
    const multiplier = language === 'ja' ? 3.5 : 4.5;
    
    return Math.min(Math.ceil(maxLength / multiplier), 1000);
  }

  private formatFileSize(bytes: number): string {
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 Bytes';
    
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'user',
            content: 'Hello, this is a health check.'
          }
        ],
        max_tokens: 10,
      });

      return response.choices.length > 0;
    } catch (error) {
      Logger.error('OpenAI health check failed', error as Error);
      return false;
    }
  }
}