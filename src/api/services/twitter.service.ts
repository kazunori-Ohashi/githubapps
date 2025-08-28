
import { OpenAIService } from './openai.service';
import { Logger } from '../../shared/logger';
import { Metrics } from '../../shared/metrics';
import * as fs from 'fs';
import * as yaml from 'js-yaml';

export class TwitterService {
  private openaiService: OpenAIService;
  private prompts: any;

  constructor() {
    this.openaiService = new OpenAIService();
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

  /**
   * Generates a Twitter intent URL for the given text.
   * If the text is longer than 140 characters, it will be summarized using OpenAI.
   * @param text The text to be tweeted.
   * @returns The Twitter intent URL.
   */
  public async createTweetIntentUrl(text: string): Promise<string> {
    try {
      const maxLen = this.getMaxLength();
      Logger.info(`Creating tweet for text of length ${text.length} (max ${maxLen})`);
      let tweetText = text;

      // Do not call OpenAI here – this method is also used after user editing.
      if (tweetText.length > maxLen) {
        tweetText = this.truncate(tweetText, maxLen);
      }

      const encodedText = encodeURIComponent(tweetText);
      const tweetUrl = `https://twitter.com/intent/tweet?text=${encodedText}`;
      
      Logger.info(`Successfully created tweet intent URL`, { urlLength: tweetUrl.length });
      Metrics.recordGitHubApiCall('twitter.intent.create', 'success'); // reusing metric bucket for now

      return tweetUrl;
    } catch (error) {
      Logger.error('Failed to create tweet intent URL', error as Error);
      Metrics.recordGitHubApiCall('twitter.intent.create', 'error');
      throw error;
    }
  }

  /**
   * Summarizes text to be under 140 characters for a tweet.
   * @param longText The text to summarize.
   * @returns A summary of the text, less than 140 characters.
   */
  public async summarizeForTweet(longText: string, guildId: string): Promise<string> {
    const maxLen = this.getMaxLength();
    // Delegate to OpenAIService which resolves per-guild API keys and prompts
    const summary = await this.openaiService.summarizeForTweet(longText, guildId, maxLen);
    return summary.length > maxLen ? this.truncate(summary, maxLen) : summary;
  }

  private getMaxLength(): number {
    const v = parseInt(process.env.TWEET_MAX || '280', 10);
    return Number.isFinite(v) && v > 0 ? v : 280;
  }

  private truncate(text: string, max: number): string {
    if (text.length <= max) return text;
    if (max <= 1) return text.slice(0, max);
    return text.substring(0, Math.max(0, max - 1)).trimEnd() + '…';
  }
}
