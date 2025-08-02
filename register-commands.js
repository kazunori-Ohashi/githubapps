
require('dotenv').config();
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');

const commands = [
  {
    name: 'issue',
    description: 'その場で思いついたアイデアをGitHub Issueとして保存します。',
    options: [
      {
        type: 1, // SUB_COMMAND
        name: 'text',
        description: '文字入力（この語文字を入力して下さい）',
        options: [] // 入力欄なし、次の発言をBotが受け付ける
      }
    ]
  },
  {
    name: 'insert',
    description: 'テキストをPREP法またはPAS法でMarkdown整形します。',
    options: [
      {
        name: 'style',
        type: 3, // STRING
        description: '整形手法を選択してください',
        required: true,
        choices: [
          {
            name: 'PREP法（Point → Reason → Example → Point）',
            value: 'prep'
          },
          {
            name: 'PAS法（Problem → Agitation → Solution）',
            value: 'pas'
          }
        ]
      }
    ]
  },
  {
    name: 'article',
    description: 'ファイルをアップロードしてPREP法またはPAS法でMarkdown整形します。',
    options: [
      {
        name: 'file',
        type: 11, // ATTACHMENT
        description: 'アップロードするファイルを選択してください。',
        required: true,
      },
      {
        name: 'style',
        type: 3, // STRING
        description: '整形手法を選択してください',
        required: true,
        choices: [
          {
            name: 'PREP法（Point → Reason → Example → Point）',
            value: 'prep'
          },
          {
            name: 'PAS法（Problem → Agitation → Solution）',
            value: 'pas'
          }
        ]
      }
    ]
  },
  {
    name: 'config',
    description: 'GitHubリポジトリとの紐付けを設定します。',
    options: [
      {
        name: 'repo',
        type: 3, // STRING
        description: 'GitHubリポジトリ（owner/repo）',
        required: true
      },
      {
        name: 'installation',
        type: 3, // STRING
        description: 'GitHub AppインストールID',
        required: true
      }
    ]
  }
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);

(async () => {
  try {
    console.log('Started refreshing application (/) commands.');

    // For global commands
    // await rest.put(
    //   Routes.applicationCommands(process.env.DISCORD_APP_ID),
    //   { body: commands },
    // );

    // For guild-specific commands (during development)
    const guildId = process.env.TEST_GUILD_ID; // Add your test guild ID to .env
    if (!guildId) {
      throw new Error('TEST_GUILD_ID is not set in the .env file.');
    }
    
    await rest.put(
      Routes.applicationGuildCommands(process.env.DISCORD_APP_ID, guildId),
      { body: commands },
    );

    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error(error);
  }
})();
