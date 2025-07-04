require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { createWallet, getUserWallet, getWalletBalance, createEvent, getEvents } = require('./contract');

// Get token from environment variable
const token = process.env.token;

// Create a bot that uses 'polling' to fetch new updates
const bot = new TelegramBot(token, { polling: true });

// Handle /create_wallet command
bot.onText(/\/create_wallet/, async (msg) => {
    try {
        const chatId = msg.chat.id;
        const telegramId = msg.from.id;
        const telegramName = msg.from.first_name || msg.from.username || 'Unknown User';

        console.log(`User ${telegramName} (${telegramId}) requested wallet creation`);

        // Check if user already has a wallet
        const existingUser = await getUserWallet(telegramId);
        
        if (existingUser) {
            await bot.sendMessage(chatId, 
                `You already have a wallet! 🎉\n\n` +
                `Wallet Address: \`${existingUser.wallet}\`\n` +
                `Name: ${existingUser.telegram_name}\n\n` +
                `Use /wallet to view your wallet details.`, 
                { parse_mode: 'Markdown' }
            );
            return;
        }

        // Create new wallet
        const walletData = await createWallet(telegramId, telegramName);

        // Send success message
        const message = 
            `🎉 Wallet created successfully!\n\n` +
            `👤 Name: ${telegramName}\n` +
            `🔑 Wallet Address: \`${walletData.address}\`\n` +
            `📱 Telegram ID: ${telegramId}\n\n` +
            `Your wallet is now ready to use! You can:\n` +
            `• Join events with /join_event\n` +
            `• Create events with /create_event\n` +
            `• View your wallet with /wallet`;

        await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });

    } catch (error) {
        console.error('Error in create_wallet handler:', error);
        await bot.sendMessage(msg.chat.id, 
            '❌ Sorry, there was an error creating your wallet. Please try again later.'
        );
    }
});

// Handle /wallet command to view wallet details
bot.onText(/\/wallet/, async (msg) => {
    try {
        const chatId = msg.chat.id;
        const telegramId = msg.from.id;

        const userData = await getUserWallet(telegramId);
        
        if (!userData) {
            await bot.sendMessage(chatId, 
                '❌ You don\'t have a wallet yet. Use /create_wallet to create one!'
            );
            return;
        }

        // Get wallet balance
        const balance = await getWalletBalance(userData.wallet);

        const message = 
            `💰 Your Wallet Details\n\n` +
            `👤 Name: ${userData.telegram_name}\n` +
            `🔑 Address: \`${userData.wallet}\`\n` +
            `📱 Telegram ID: ${telegramId}\n` +
            `💎 Balance: ${balance} ETH`;

        await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });

    } catch (error) {
        console.error('Error in wallet handler:', error);
        await bot.sendMessage(msg.chat.id, 
            '❌ Sorry, there was an error retrieving your wallet. Please try again later.'
        );
    }
});

// Store user states for event creation
const userStates = new Map();

// Handle /create_event command
bot.onText(/\/create_event/, async (msg) => {
    try {
        const chatId = msg.chat.id;
        const telegramId = msg.from.id;

        // Check if user has wallet
        const userData = await getUserWallet(telegramId);
        if (!userData) {
            await bot.sendMessage(chatId, 
                '❌ You need a wallet first! Use /create_wallet to create one.'
            );
            return;
        }

        // Initialize user state for event creation
        userStates.set(telegramId, {
            step: 'event_name',
            data: {}
        });

        await bot.sendMessage(chatId, 
            '🎉 Let\'s create an event! I\'ll guide you through each step.\n\n' +
            '📝 **Step 1: Event Name**\n' +
            'Please send me the name of your event:',
            { parse_mode: 'Markdown' }
        );

    } catch (error) {
        console.error('Error starting event creation:', error);
        await bot.sendMessage(msg.chat.id, 
            '❌ Sorry, there was an error. Please try again later.'
        );
    }
});

// Handle event creation steps
bot.on('message', async (msg) => {
    try {
        const chatId = msg.chat.id;
        const telegramId = msg.from.id;
        const userState = userStates.get(telegramId);

        // Skip if user is not in event creation flow
        if (!userState || msg.text?.startsWith('/')) {
            return;
        }

        const { step, data } = userState;

        switch (step) {
            case 'event_name':
                data.eventName = msg.text;
                userState.step = 'event_date';
                userStates.set(telegramId, userState);
                
                await bot.sendMessage(chatId, 
                    '📅 **Step 2: Event Date & Time**\n' +
                    'Please send the date and time in this format:\n' +
                    '`YYYY-MM-DD HH:MM`\n\n' +
                    'Example: `2024-12-25 18:30`',
                    { parse_mode: 'Markdown' }
                );
                break;

            case 'event_date':
                const dateInput = msg.text;
                const eventDate = new Date(dateInput);
                
                if (isNaN(eventDate.getTime())) {
                    await bot.sendMessage(chatId, 
                        '❌ Invalid date format! Please use: `YYYY-MM-DD HH:MM`\n' +
                        'Example: `2024-12-25 18:30`',
                        { parse_mode: 'Markdown' }
                    );
                    return;
                }

                if (eventDate <= new Date()) {
                    await bot.sendMessage(chatId, 
                        '❌ Event date must be in the future! Please enter a valid date.'
                    );
                    return;
                }

                data.eventDate = eventDate.toISOString();
                userState.step = 'stake_amount';
                userStates.set(telegramId, userState);
                
                await bot.sendMessage(chatId, 
                    '💰 **Step 3: Stake Amount**\n' +
                    'How much ETH should participants stake to join?\n' +
                    'Please send a number (e.g., `0.01` for 0.01 ETH):',
                    { parse_mode: 'Markdown' }
                );
                break;

            case 'stake_amount':
                const stakeAmount = parseFloat(msg.text);
                
                if (isNaN(stakeAmount) || stakeAmount <= 0) {
                    await bot.sendMessage(chatId, 
                        '❌ Please enter a valid positive number for the stake amount.'
                    );
                    return;
                }

                data.stakeAmount = stakeAmount;
                userState.step = 'location';
                userStates.set(telegramId, userState);
                
                await bot.sendMessage(chatId, 
                    '📍 **Step 4: Event Location**\n' +
                    'Please send the location of your event.\n\n' +
                    'You can either:\n' +
                    '• Send a location via Telegram (recommended)\n' +
                    '• Or type the address manually',
                    { parse_mode: 'Markdown' }
                );
                break;

            case 'location':
                // Check if it's a location message
                if (msg.location) {
                    data.locationLat = msg.location.latitude;
                    data.locationLng = msg.location.longitude;
                    data.locationText = 'Location shared via Telegram';
                } else {
                    data.locationText = msg.text;
                    data.locationLat = null;
                    data.locationLng = null;
                }

                // Create the event
                await bot.sendMessage(chatId, '⏳ Creating your event... Please wait.');
                
                try {
                    const result = await createEvent(
                        telegramId,
                        data.eventName,
                        data.eventDate,
                        data.stakeAmount,
                        data.locationLat,
                        data.locationLng
                    );

                    // Get user data for display
                    const userData = await getUserWallet(telegramId);

                    const successMessage = 
                        `🎉 **Event Created Successfully!**\n\n` +
                        `📝 **Event Details:**\n` +
                        `• Name: ${data.eventName}\n` +
                        `• Date: ${new Date(data.eventDate).toLocaleString()}\n` +
                        `• Stake: ${data.stakeAmount} ETH\n` +
                        `• Location: ${data.locationText}\n` +
                        `• Creator: \`${userData.wallet}\`\n\n` +
                        `🔗 **Blockchain Info:**\n` +
                        `• Event ID: \`${result.eventId}\`\n` +
                        `• Transaction: \`${result.txHash}\`\n` +
                        `• Bot Wallet: \`${result.botWallet}\`\n\n` +
                        `✅ Your event is now live on the blockchain!`;

                    await bot.sendMessage(chatId, successMessage, { parse_mode: 'Markdown' });

                } catch (error) {
                    console.error('Error creating event:', error);
                    await bot.sendMessage(chatId, 
                        '❌ Failed to create event. Please try again later.'
                    );
                }

                // Clear user state
                userStates.delete(telegramId);
                break;
        }

    } catch (error) {
        console.error('Error in event creation flow:', error);
        await bot.sendMessage(msg.chat.id, 
            '❌ Sorry, there was an error. Please try /create_event again.'
        );
        userStates.delete(msg.from.id);
    }
});

