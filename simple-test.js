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
  console.log(`✅ Bot logged in as ${client.user.tag}`);
  console.log(`📊 Connected to ${client.guilds.cache.size} guilds`);
});

client.on('messageCreate', (message) => {
  if (message.author.bot) return;
  console.log(`📨 Message: "${message.content}" from ${message.author.tag}`);
});

client.on('error', (error) => {
  console.error('❌ Discord client error:', error);
});

client.on('disconnect', () => {
  console.log('🔌 Disconnected from Discord');
});

process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled rejection:', error);
});

console.log('🚀 Starting bot...');
client.login(process.env.DISCORD_BOT_TOKEN)
  .then(() => console.log('🔑 Login successful'))
  .catch(error => console.error('❌ Login failed:', error));