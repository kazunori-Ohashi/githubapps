import OpenAI from 'openai';
import { Logger } from '../../shared/logger';
import { ExternalServiceError, ValidationError } from '../../shared/error-handler';
import { Metrics } from '../../shared/metrics';
import { ProcessedFile } from '../../shared/types';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { SecretStore, SECRET_KEYS } from '../../shared/secret-store';

export interface SummarizationOptions {
  maxLength?: number;
  style?: 'brief' | 'detailed' | 'bullet-points';
  language?: 'ja' | 'en';
}

export class OpenAIService {
  private prompts: any;

  constructor() {
    // Load prompts from YAML file
    this.loadPrompts();
  }

  private async getClientForGuild(guildId: string): Promise<OpenAI> {
    const key = await SecretStore.get(guildId, SECRET_KEYS.openai) || process.env.OPENAI_API_KEY;
    if (!key) {
      throw new ValidationError('OpenAI APIキーが未設定です。/config openai_key で設定してください。');
    }
    return new OpenAI({ apiKey: key });
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
    options: SummarizationOptions = {},
    guildId: string
  ): Promise<string> {
    const startTime = Date.now();
    
    try {
      Logger.info(`Starting file summarization`, {
        fileName: file.original_name,
        fileSize: file.size,
        fileType: file.type
      });

      const client = await this.getClientForGuild(guildId);
      const prompt = this.buildSummarizationPrompt(file, options);
      
      const response = await client.chat.completions.create({
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

  async healthCheckForGuild(guildId: string): Promise<boolean> {
    try {
      const client = await this.getClientForGuild(guildId);
      const response = await client.chat.completions.create({
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

  async formatWithInsert(content: string, style: 'prep' | 'pas', guildId: string): Promise<string> {
    const startTime = Date.now();
    
    try {
      Logger.info(`Starting insert formatting`, {
        style,
        contentLength: content.length
      });

      const client = await this.getClientForGuild(guildId);
      const systemPrompt = this.prompts.insert.system_prompt.content;
      const template = style === 'prep' 
        ? this.prompts.insert.prep_template.content 
        : this.prompts.insert.pas_template.content;
      
      const userPrompt = template.replace('{content}', content);
      
      const response = await client.chat.completions.create({
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

  /**
   * Summarize long text for tweeting. Uses twitter prompts from prompts.yaml.
   * Falls back to truncation if OpenAI fails.
   */
  async summarizeForTweet(longText: string, guildId: string, maxChars: number = 280): Promise<string> {
    const startTime = Date.now();
    try {
      const client = await this.getClientForGuild(guildId);

      // Build prompts from YAML and inject runtime hints about max length
      const systemPrompt: string = this.prompts?.twitter?.system || 'You are a skilled social media copywriter.';
      const baseUser: string = this.prompts?.twitter?.user || 'Please summarize the following text into a single tweet.';

      const userPrompt = `${baseUser}\n\n(Keep under ${maxChars} characters including spaces.)\n\n---\n${longText}`;

      const response = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: Math.max(60, Math.min(140, Math.ceil(maxChars * 0.6))),
        temperature: 0.7,
      });

      let summary = response.choices?.[0]?.message?.content?.trim() || '';
      if (!summary) {
        throw new ExternalServiceError('OpenAI', 'Empty summary');
      }

      // Enforce max length as final safeguard
      if (summary.length > maxChars) {
        summary = summary.substring(0, Math.max(0, maxChars - 1)).trimEnd() + '…';
      }

      Metrics.recordOpenAIApiCall('gpt-4o-mini', 'success');
      return summary;
    } catch (error) {
      Logger.error('summarizeForTweet failed', error as Error);
      Metrics.recordOpenAIApiCall('gpt-4o-mini', 'error');
      // Fallback: simple truncation
      const safeMax = Math.max(10, maxChars);
      return longText.length > safeMax
        ? longText.substring(0, Math.max(0, safeMax - 1)).trimEnd() + '…'
        : longText;
    } finally {
      const duration = (Date.now() - startTime) / 1000;
      Logger.debug('summarizeForTweet completed', { duration: `${duration}s` });
    }
  }
}
