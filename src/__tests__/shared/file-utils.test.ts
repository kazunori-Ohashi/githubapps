import { FileUtils } from '../../shared/file-utils';
import { GitHubInstallation, GuildMapping } from '../../shared/types';
import * as fs from 'fs/promises';
import * as path from 'path';

const TEST_DATA_PATH = './test_data';

describe('FileUtils', () => {
  beforeEach(async () => {
    process.env.DATA_PATH = TEST_DATA_PATH;
    
    // Clean up test data directory
    try {
      await fs.rm(TEST_DATA_PATH, { recursive: true, force: true });
    } catch (error) {
      // Directory might not exist
    }
    
    // Create test data directory
    await fs.mkdir(TEST_DATA_PATH, { recursive: true });
  });

  afterEach(async () => {
    // Clean up after tests
    try {
      await fs.rm(TEST_DATA_PATH, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('Installation management', () => {
    const mockInstallation: GitHubInstallation = {
      installation_id: 12345,
      app_id: 67890,
      account: {
        login: 'test-user',
        id: 11111,
        type: 'User'
      },
      repositories: [
        {
          id: 22222,
          name: 'test-repo',
          full_name: 'test-user/test-repo'
        }
      ],
      permissions: {
        issues: 'write',
        contents: 'read'
      },
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z'
    };

    test('should save and retrieve installation', async () => {
      await FileUtils.saveInstallation(mockInstallation);
      
      const retrieved = await FileUtils.getInstallation(12345);
      
      expect(retrieved).toEqual(mockInstallation);
    });

    test('should return null for non-existent installation', async () => {
      const retrieved = await FileUtils.getInstallation(99999);
      
      expect(retrieved).toBeNull();
    });

    test('should delete installation', async () => {
      await FileUtils.saveInstallation(mockInstallation);
      await FileUtils.deleteInstallation(12345);
      
      const retrieved = await FileUtils.getInstallation(12345);
      
      expect(retrieved).toBeNull();
    });
  });

  describe('Guild mapping management', () => {
    const mockGuildMapping: GuildMapping = {
      guild_id: '888888888888888888',
      guild_name: 'Test Discord Server',
      installation_id: 12345,
      default_repo: {
        owner: 'test-user',
        name: 'test-repo'
      },
      channels: [
        {
          channel_id: '999999999999999999',
          channel_name: 'general'
        }
      ],
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z'
    };

    test('should save and retrieve guild mapping', async () => {
      await FileUtils.saveGuildMapping(mockGuildMapping);
      
      const retrieved = await FileUtils.getGuildMapping('888888888888888888');
      
      expect(retrieved).toEqual(mockGuildMapping);
    });

    test('should return null for non-existent guild mapping', async () => {
      const retrieved = await FileUtils.getGuildMapping('nonexistent');
      
      expect(retrieved).toBeNull();
    });

    test('should delete guild mapping', async () => {
      await FileUtils.saveGuildMapping(mockGuildMapping);
      await FileUtils.deleteGuildMapping('888888888888888888');
      
      const retrieved = await FileUtils.getGuildMapping('888888888888888888');
      
      expect(retrieved).toBeNull();
    });
  });

  describe('Finding guilds by installation', () => {
    test('should find guilds associated with installation', async () => {
      const guild1: GuildMapping = {
        guild_id: 'guild1',
        guild_name: 'Guild 1',
        installation_id: 12345,
        default_repo: { owner: 'test', name: 'repo1' },
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z'
      };

      const guild2: GuildMapping = {
        guild_id: 'guild2',
        guild_name: 'Guild 2',
        installation_id: 12345,
        default_repo: { owner: 'test', name: 'repo2' },
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z'
      };

      const guild3: GuildMapping = {
        guild_id: 'guild3',
        guild_name: 'Guild 3',
        installation_id: 54321,
        default_repo: { owner: 'test', name: 'repo3' },
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z'
      };

      await FileUtils.saveGuildMapping(guild1);
      await FileUtils.saveGuildMapping(guild2);
      await FileUtils.saveGuildMapping(guild3);

      const guildsForInstallation = await FileUtils.findGuildsByInstallation(12345);

      expect(guildsForInstallation).toHaveLength(2);
      expect(guildsForInstallation.map(g => g.guild_id)).toContain('guild1');
      expect(guildsForInstallation.map(g => g.guild_id)).toContain('guild2');
      expect(guildsForInstallation.map(g => g.guild_id)).not.toContain('guild3');
    });

    test('should return empty array for non-existent installation', async () => {
      const guilds = await FileUtils.findGuildsByInstallation(99999);
      
      expect(guilds).toEqual([]);
    });
  });
});