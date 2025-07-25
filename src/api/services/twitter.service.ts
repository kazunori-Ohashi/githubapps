
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
      Logger.info(`Creating tweet for text of length ${text.length}`);
      let tweetText = text;

      if (text.length > 140) {
        Logger.debug('Text is over 140 characters, summarizing for tweet.');
        tweetText = await this.summarizeForTweet(text);
      }

      const encodedText = encodeURIComponent(tweetText);
      const tweetUrl = `https://twitter.com/intent/tweet?text=${encodedText}`;
      
      Logger.info(`Successfully created tweet intent URL`, { urlLength: tweetUrl.length });
      Metrics.recordGitHubApiCall('twitter.intent.create', 'success'); // Using GitHub metrics for now

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
  public async summarizeForTweet(longText: string): Promise<string> {
    const systemPrompt = this.prompts.twitter.system;
    const userPrompt = this.prompts.twitter.user.replace('{longText}', longText);

    try {
      const response = await (this.openaiService as any).client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: 60, // Approx 140 chars
        temperature: 0.7,
      });

      const summary = response.choices[0]?.message?.content?.trim();
      if (!summary) {
        throw new Error('OpenAI returned an empty summary.');
      }
      
      return summary.length > 140 ? summary.substring(0, 140) : summary;

    } catch (error) {
      Logger.error('Failed to summarize text for tweet', error as Error);
      // Fallback to simple truncation if AI fails
      return longText.substring(0, 137) + '...';
    }
  }
}
