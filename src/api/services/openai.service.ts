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
        temperature: 0.5,
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
    return this.prompts.issue.system_prompt.content;
  }

  private buildSummarizationPrompt(file: ProcessedFile, options: SummarizationOptions): string {
    let promptTemplate = this.prompts.issue.formatting_template.content;
    
    // Replace placeholders
    promptTemplate = promptTemplate.replace('{content}', file.content);
    
    return promptTemplate;
  }



  private formatFileSize(bytes: number): string {
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 Bytes';
    
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  }

  private cleanFormattedContent(content: string): string {
    // ガイドラインや指示文を除去
    const lines = content.split('\n');
    const cleanedLines: string[] = [];
    let skipSection = false;
    
    for (const line of lines) {
      // ガイドラインセクションをスキップ
      if (line.includes('ガイドライン') || line.includes('### ガイドライン')) {
        skipSection = true;
        continue;
      }
      
      // 指示文をスキップ
      if (line.includes('以下のテキストを') || line.includes('出力フォーマット')) {
        skipSection = true;
        continue;
      }
      
      // 空行でセクション終了を検出
      if (skipSection && line.trim() === '') {
        skipSection = false;
        continue;
      }
      
      // スキップ中でない場合のみ追加
      if (!skipSection) {
        cleanedLines.push(line);
      }
    }
    
    return cleanedLines.join('\n').trim();
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

  async formatWithInsert(content: string, style: 'prep' | 'pas'): Promise<string> {
    const startTime = Date.now();
    
    try {
      Logger.info(`Starting insert formatting`, {
        style,
        contentLength: content.length
      });

      const systemPrompt = this.prompts.insert.system_prompt.content;
      const template = style === 'prep' 
        ? this.prompts.insert.prep_template.content 
        : this.prompts.insert.pas_template.content;
      
      const userPrompt = template.replace('{content}', content);
      
      const response = await this.client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: systemPrompt
          },
          {
            role: 'user',
            content: userPrompt
          }
        ],
        temperature: 0.5,
      });

      const result = response.choices[0]?.message?.content;
      
      if (!result) {
        throw new ExternalServiceError('OpenAI', 'No formatted content generated');
      }

      // ガイドラインや指示文を除去
      const cleanedResult = this.cleanFormattedContent(result);

      const duration = (Date.now() - startTime) / 1000;
      
      Logger.info(`Insert formatting completed`, {
        style,
        resultLength: cleanedResult.length,
        duration: `${duration}s`
      });

      Metrics.recordOpenAIApiCall('gpt-4o-mini', 'success');
      
      return cleanedResult.trim();
      
    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      
      Logger.error(`Insert formatting failed`, error as Error, {
        style,
        contentLength: content.length,
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
}