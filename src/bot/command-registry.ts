import { REST } from '@discordjs/rest';
import { Routes, APIApplicationCommand } from 'discord-api-types/v10';
import { Logger } from '../shared/logger';

// Central command definitions (must match InteractionHandler)
const commands: Partial<APIApplicationCommand>[] = [
  {
    name: 'issue',
    description: 'その場の発言をGitHub Issueに保存',
    options: [
      {
        type: 1, // SUB_COMMAND
        name: 'text',
        description: '直後の発言をIssue化します',
        options: []
      }
    ]
  },
  {
    name: 'insert',
    description: 'テキストをPREP/PASでMarkdown整形',
    options: [
      {
        name: 'style',
        type: 3, // STRING
        description: '整形スタイル',
        required: true,
        choices: [
          { name: 'PREP', value: 'prep' },
          { name: 'PAS', value: 'pas' }
        ]
      }
    ]
  },
  {
    name: 'article',
    description: 'ファイルを整形してIssueに保存',
    options: [
      { name: 'file', type: 11, description: '添付ファイル', required: true },
      { name: 'style', type: 3, description: '整形スタイル', required: true, choices: [
        { name: 'PREP', value: 'prep' },
        { name: 'PAS', value: 'pas' }
      ]}
    ]
  },
  {
    name: 'config',
    description: '設定（OpenAIキー/Repo紐付けなど）',
    options: [
      { type: 1, name: 'openai_key', description: 'OpenAI APIキーを保存', options: [
        { name: 'key', type: 3, description: 'sk- で始まるAPIキー', required: true }
      ]},
      { type: 1, name: 'status', description: '設定状況を表示' },
      { type: 1, name: 'delete_openai', description: 'OpenAI APIキーを削除' },
      { type: 1, name: 'test_openai', description: 'OpenAI キー疎通テスト' },
      { type: 1, name: 'repo', description: 'GitHub リポジトリ紐付け（例: name=owner/repo, installation=GitHub App のインストールID）', options: [
        { name: 'name', type: 3, description: 'Issueを作成するリポジトリ (owner/repo)。例: ame00000/githubapps', required: true },
        { name: 'installation', type: 3, description: 'GitHub App のインストールID。例: 12345678（取得: App設定→InstallationsのURL末尾）', required: true }
      ]},
      { type: 1, name: 'repo_help', description: 'repo 設定の入力方法を表示' }
    ]
  }
];

export async function syncSlashCommands(): Promise<void> {
  const appId = process.env.DISCORD_APP_ID;
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!appId || !token) {
    Logger.warn('Skip command sync: DISCORD_APP_ID or DISCORD_BOT_TOKEN missing');
    return;
  }
  const scope = (process.env.COMMAND_SCOPE || 'guild').toLowerCase();
  const rest = new REST({ version: '10' }).setToken(token);
  try {
    if (scope === 'global') {
      await rest.put(Routes.applicationCommands(appId), { body: commands });
      Logger.info('Slash commands synced globally');
    } else {
      const guildId = process.env.TEST_GUILD_ID || process.env.DEFAULT_GUILD_ID;
      if (!guildId) {
        Logger.warn('COMMAND_SCOPE=guild but TEST_GUILD_ID/DEFAULT_GUILD_ID not set; skipping sync');
        return;
      }
      await rest.put(Routes.applicationGuildCommands(appId, guildId), { body: commands });
      Logger.info(`Slash commands synced to guild ${guildId}`);
    }
  } catch (e) {
    Logger.error('Failed to sync slash commands', e as Error);
  }
}

