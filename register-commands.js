
require('dotenv').config();
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');

const commands = [
  {
    name: 'issue',
    description: 'Create a GitHub Issue with an AI summary.',
    options: [
      {
        name: 'mode',
        type: 3, // STRING
        description: "Processing mode: 'file' or 'text'",
        required: true,
        choices: [
          {
            name: 'File',
            value: 'file'
          },
          {
            name: 'Text',
            value: 'text'
          }
        ]
      },
      {
        name: 'file',
        type: 11, // ATTACHMENT
        description: 'The file to summarize and create an issue from.',
        required: false,
      },
      {
        name: 'content',
        type: 3, // STRING
        description: 'The text content to summarize and create an issue from (max 4000 chars).',
        required: false,
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
