require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
});

client.on('messageCreate', (message) => {
  console.log(`Message received: "${message.content}" from ${message.author.tag}`);
  console.log(`Guild ID: ${message.guild?.id}`);
  console.log(`Channel ID: ${message.channel.id}`);
  console.log(`Attachments: ${message.attachments.size}`);
  
  if (message.attachments.size > 0) {
    message.attachments.forEach(attachment => {
      console.log(`Attachment: ${attachment.name}`);
    });
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);