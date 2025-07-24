import { OpenAIService } from '../../../api/services/openai.service';
import { ProcessedFile } from '../../../shared/types';

// Mock OpenAI
jest.mock('openai', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: jest.fn()
        }
      }
    }))
  };
});

describe('OpenAIService', () => {
  let openaiService: OpenAIService;
  let mockOpenAI: any;

  beforeEach(() => {
    // Set required environment variable
    process.env.OPENAI_API_KEY = 'test-api-key';
    
    // Get the mocked OpenAI constructor
    const OpenAI = require('openai').default;
    mockOpenAI = new OpenAI();
    
    openaiService = new OpenAIService();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('summarizeFile', () => {
    const mockFile: ProcessedFile = {
      original_name: 'test.md',
      content: 'This is a test markdown file with some content.',
      size: 45,
      type: 'markdown'
    };

    test('should successfully summarize a file', async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              content: 'This is a summary of the test file.'
            }
          }
        ]
      };

      mockOpenAI.chat.completions.create.mockResolvedValue(mockResponse);

      const result = await openaiService.summarizeFile(mockFile);

      expect(result).toBe('This is a summary of the test file.');
      expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: expect.stringContaining('要約アシスタント')
          },
          {
            role: 'user',
            content: expect.stringContaining('test.md')
          }
        ],
        max_tokens: expect.any(Number),
        temperature: 0.3
      });
    });

    test('should handle OpenAI API errors', async () => {
      const mockError = new Error('API Error');
      mockError.name = 'APIError';
      (mockError as any).status = 429;
      (mockError as any).type = 'rate_limit_exceeded';

      mockOpenAI.chat.completions.create.mockRejectedValue(mockError);

      await expect(openaiService.summarizeFile(mockFile)).rejects.toThrow();
    });

    test('should handle empty response', async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              content: null
            }
          }
        ]
      };

      mockOpenAI.chat.completions.create.mockResolvedValue(mockResponse);

      await expect(openaiService.summarizeFile(mockFile)).rejects.toThrow('No summary generated');
    });

    test('should use custom options', async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              content: 'Detailed summary'
            }
          }
        ]
      };

      mockOpenAI.chat.completions.create.mockResolvedValue(mockResponse);

      const options = {
        maxLength: 1000,
        style: 'detailed' as const,
        language: 'en' as const
      };

      await openaiService.summarizeFile(mockFile, options);

      expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: expect.stringContaining('detailed')
          },
          {
            role: 'user',
            content: expect.stringContaining('Please summarize')
          }
        ],
        max_tokens: expect.any(Number),
        temperature: 0.3
      });
    });
  });

  describe('healthCheck', () => {
    test('should return true when OpenAI is healthy', async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              content: 'Hello'
            }
          }
        ]
      };

      mockOpenAI.chat.completions.create.mockResolvedValue(mockResponse);

      const result = await openaiService.healthCheck();

      expect(result).toBe(true);
    });

    test('should return false when OpenAI is unhealthy', async () => {
      mockOpenAI.chat.completions.create.mockRejectedValue(new Error('Service unavailable'));

      const result = await openaiService.healthCheck();

      expect(result).toBe(false);
    });
  });
});