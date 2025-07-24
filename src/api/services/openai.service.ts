import OpenAI from 'openai';
import { Logger } from '../../shared/logger';
import { ExternalServiceError } from '../../shared/error-handler';
import { Metrics } from '../../shared/metrics';
import { ProcessedFile } from '../../shared/types';

export interface SummarizationOptions {
  maxLength?: number;
  style?: 'brief' | 'detailed' | 'bullet-points';
  language?: 'ja' | 'en';
}

export class OpenAIService {
  private client: OpenAI;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }

    this.client = new OpenAI({
      apiKey,
    });
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

    const basePrompts = {
      ja: {
        brief: 'あなたは優秀な要約アシスタントです。提供されたファイルの内容を簡潔で分かりやすい日本語で要約してください。',
        detailed: 'あなたは優秀な要約アシスタントです。提供されたファイルの内容を詳細で構造化された日本語で要約してください。',
        'bullet-points': 'あなたは優秀な要約アシスタントです。提供されたファイルの内容を箇条書き形式で日本語で要約してください。'
      },
      en: {
        brief: 'You are an excellent summarization assistant. Please summarize the provided file content in concise and clear English.',
        detailed: 'You are an excellent summarization assistant. Please summarize the provided file content in detailed and structured English.',
        'bullet-points': 'You are an excellent summarization assistant. Please summarize the provided file content in bullet-point format in English.'
      }
    };

    return basePrompts[language][style];
  }

  private buildSummarizationPrompt(file: ProcessedFile, options: SummarizationOptions): string {
    const language = options.language || 'ja';
    
    const prompts = {
      ja: `
以下のファイルの内容を要約してください：

ファイル名: ${file.original_name}
ファイルタイプ: ${file.type}
ファイルサイズ: ${this.formatFileSize(file.size)}

内容:
\`\`\`
${file.content}
\`\`\`

要約は以下の形式で出力してください：
- 重要なポイントを明確に
- 読みやすい構造で
- 適切な長さで（${options.maxLength || 500}文字以内）
`,
      en: `
Please summarize the following file content:

File name: ${file.original_name}
File type: ${file.type}
File size: ${this.formatFileSize(file.size)}

Content:
\`\`\`
${file.content}
\`\`\`

Please output the summary in the following format:
- Clearly highlight important points
- Use readable structure
- Keep appropriate length (within ${options.maxLength || 500} characters)
`
    };

    return prompts[language];
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