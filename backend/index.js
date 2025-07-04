const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const https = require('https');

// Get token from environment variable
const token = process.env.token;

// Create a bot that uses 'polling' to fetch new updates
const bot = new TelegramBot(token, { polling: true });