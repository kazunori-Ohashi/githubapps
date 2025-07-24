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
  console.log(`✅ Bot ready: ${client.user.tag}`);
});

client.on('messageCreate', (message) => {
  if (message.author.bot) return;
  
  console.log(`\n📨 NEW MESSAGE:`);
  console.log(`   Content: "${message.content}"`);
  console.log(`   Author: ${message.author.tag}`);
  console.log(`   Guild: ${message.guild?.name || 'DM'}`);
  console.log(`   Channel: ${message.channel.name || 'Unknown'}`);
  console.log(`   Attachments: ${message.attachments.size}`);
  
  if (message.attachments.size > 0) {
    message.attachments.forEach((attachment, index) => {
      console.log(`   📎 File ${index + 1}: ${attachment.name} (${attachment.size} bytes)`);
    });
  }
});

console.log('🚀 Starting file detection bot...');
client.login(process.env.DISCORD_BOT_TOKEN);