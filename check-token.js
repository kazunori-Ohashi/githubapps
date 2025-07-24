require('dotenv').config();

console.log('Bot Token exists:', !!process.env.DISCORD_BOT_TOKEN);
console.log('Token starts with:', process.env.DISCORD_BOT_TOKEN?.substring(0, 10));
console.log('Token length:', process.env.DISCORD_BOT_TOKEN?.length);