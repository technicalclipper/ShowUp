require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const https = require('https');

// Get token from environment variable
const token = process.env.token;

// Create a bot that uses 'polling' to fetch new updates
const bot = new TelegramBot(token, { polling: true });

bot.on('message', async (msg) => {
    try {
      // Log chat information to see group IDs
      console.log('Chat Type:', msg.chat.type);
      console.log('Chat ID:', msg.chat.id);
      console.log('Chat Title:', msg.chat.title || 'Private Chat');
      console.log('From User:', msg.from.first_name, msg.from.id);
      
      await bot.sendMessage(msg.chat.id, 'huh');
    } catch (error) {
      console.error('Error sending hi message:', error);
    }
  });
  