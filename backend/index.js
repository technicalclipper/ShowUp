require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { createWallet, getUserWallet, getWalletBalance, createEvent, getEvents, getJoinedEvents, getEventByName, getEventById, joinEvent } = require('./contract');

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

// Store user states for event creation and joining
const userStates = new Map();
const joinStates = new Map();

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



// Handle /events command to list all events
bot.onText(/\/events/, async (msg) => {
    try {
        const chatId = msg.chat.id;
        const telegramId = msg.from.id;
        
        // Get all available events
        const allEvents = await getEvents();
        
        // Get events joined by this user
        const joinedEvents = await getJoinedEvents(telegramId);
        
        let message = '';

        // Show available events (events not joined by user)
        const availableEvents = allEvents.filter(event => 
            !joinedEvents.some(joined => joined.events.id === event.id)
        );

        if (availableEvents.length > 0) {
            message += '📅 **Available Events:**\n\n';
            
            availableEvents.forEach((event, index) => {
                const eventDate = new Date(event.date).toLocaleString();
                message += `${index + 1}. **${event.name}**\n`;
                message += `   📅 ${eventDate}\n`;
                message += `   💰 Stake: ${event.stake_amount} ETH\n`;
                message += `   👤 Creator: \`${event.creator}\`\n`;
                message += `   ${event.finalized ? '✅ Finalized' : '⏳ Active'}\n\n`;
            });
        } else {
            message += '📅 **No available events to join.**\n\n';
        }

        // Show joined events
        if (joinedEvents.length > 0) {
            message += '🎉 **Your Joined Events:**\n\n';
            
            joinedEvents.forEach((joined, index) => {
                const event = joined.events;
                const eventDate = new Date(event.date).toLocaleString();
                message += `${index + 1}. **${event.name}**\n`;
                message += `   📅 ${eventDate}\n`;
                message += `   💰 Stake: ${event.stake_amount} ETH\n`;
                message += `   👤 Creator: \`${event.creator}\`\n`;
                message += `   ${joined.attended ? '✅ Attended' : '⏳ Not Attended'}\n`;
                message += `   ${event.finalized ? '🏁 Event Finalized' : '🔄 Event Active'}\n\n`;
            });
        } else {
            message += '🎉 **You haven\'t joined any events yet.**\n';
            message += 'Use /join_event to join an event!\n\n';
        }

        // Add helpful footer
        if (allEvents.length === 0) {
            message = '📅 **No events found.**\n\nCreate one with /create_event!';
        } else {
            message += '💡 **Tips:**\n';
            message += '• Use /join_event to join available events\n';
            message += '• Use /create_event to create new events\n';
            message += '• Show up to events to get your stake back + rewards!';
        }

        await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });

    } catch (error) {
        console.error('Error listing events:', error);
        await bot.sendMessage(msg.chat.id, 
            '❌ Sorry, there was an error retrieving events. Please try again later.'
        );
    }
});

// Handle /join_event command
bot.onText(/\/join_event/, async (msg) => {
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

        // Initialize user state for event joining
        joinStates.set(telegramId, {
            step: 'event_name',
            data: {}
        });

        await bot.sendMessage(chatId, 
            '🎉 Let\'s join an event! I\'ll guide you through the process.\n\n' +
            '📝 **Step 1: Event Name**\n' +
            'Please send me the name of the event you want to join:',
            { parse_mode: 'Markdown' }
        );

    } catch (error) {
        console.error('Error starting event joining:', error);
        await bot.sendMessage(msg.chat.id, 
            '❌ Sorry, there was an error. Please try again later.'
        );
    }
});

// Handle event joining steps
bot.on('message', async (msg) => {
    try {
        const chatId = msg.chat.id;
        const telegramId = msg.from.id;
        const userState = userStates.get(telegramId);
        const joinState = joinStates.get(telegramId);

        // Handle event creation flow
        if (userState && !msg.text?.startsWith('/')) {
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
            return;
        }

        // Handle event joining flow
        if (joinState && !msg.text?.startsWith('/')) {
            const { step, data } = joinState;

            switch (step) {
                case 'event_name':
                    const eventName = msg.text;
                    const events = await getEventByName(eventName);
                    
                    if (events.length === 0) {
                        await bot.sendMessage(chatId, 
                            '❌ No events found with that name. Please try again or use /events to see available events.'
                        );
                        return;
                    }

                    if (events.length === 1) {
                        // Single event found, proceed to confirmation
                        const event = events[0];
                        data.selectedEvent = event;
                        joinState.step = 'confirmation';
                        joinStates.set(telegramId, joinState);

                        const eventDate = new Date(event.date).toLocaleString();
                        const message = 
                            `📅 **Event Found:** ${event.name}\n\n` +
                            `📅 Date: ${eventDate}\n` +
                            `💰 Stake Amount: ${event.stake_amount} ETH\n` +
                            `👤 Creator: \`${event.creator}\`\n\n` +
                            `⚠️ **Important:** Joining this event will stake ${event.stake_amount} ETH from your wallet.\n\n` +
                            `React with 👍 to confirm and join the event, or send "cancel" to abort.`;

                        await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
                    } else {
                        // Multiple events found, show options
                        data.eventOptions = events;
                        joinState.step = 'select_event';
                        joinStates.set(telegramId, joinState);

                        let message = `📅 **Multiple events found:**\n\n`;
                        events.forEach((event, index) => {
                            const eventDate = new Date(event.date).toLocaleString();
                            message += `${index + 1}. **${event.name}**\n`;
                            message += `   📅 ${eventDate}\n`;
                            message += `   💰 Stake: ${event.stake_amount} ETH\n\n`;
                        });
                        message += `Please send the number (1-${events.length}) of the event you want to join:`;

                        await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
                    }
                    break;

                case 'select_event':
                    const selection = parseInt(msg.text);
                    if (isNaN(selection) || selection < 1 || selection > data.eventOptions.length) {
                        await bot.sendMessage(chatId, 
                            `❌ Please send a number between 1 and ${data.eventOptions.length}.`
                        );
                        return;
                    }

                    const selectedEvent = data.eventOptions[selection - 1];
                    data.selectedEvent = selectedEvent;
                    joinState.step = 'confirmation';
                    joinStates.set(telegramId, joinState);

                    const eventDate = new Date(selectedEvent.date).toLocaleString();
                    const message = 
                        `📅 **Event Selected:** ${selectedEvent.name}\n\n` +
                        `📅 Date: ${eventDate}\n` +
                        `💰 Stake Amount: ${selectedEvent.stake_amount} ETH\n` +
                        `👤 Creator: \`${selectedEvent.creator}\`\n\n` +
                        `⚠️ **Important:** Joining this event will stake ${selectedEvent.stake_amount} ETH from your wallet.\n\n` +
                        `React with 👍 to confirm and join the event, or send "cancel" to abort.`;

                    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
                    break;

                case 'confirmation':
                    if (msg.text?.toLowerCase() === 'cancel') {
                        await bot.sendMessage(chatId, '❌ Event joining cancelled.');
                        joinStates.delete(telegramId);
                        return;
                    }

                    // Check if user reacted with 👍 or sent "confirm"
                    if (msg.text?.toLowerCase() === 'confirm' || msg.text?.toLowerCase() === 'yes') {
                        await bot.sendMessage(chatId, '⏳ Joining event... Please wait.');
                        
                        try {
                            const result = await joinEvent(telegramId, data.selectedEvent.id);
                            
                            const successMessage = 
                                `🎉 **Successfully Joined Event!**\n\n` +
                                `📅 **Event:** ${result.eventName}\n` +
                                `💰 **Stake Paid:** ${result.stakeAmount} ETH\n` +
                                `🔗 **Transaction:** \`${result.txHash}\`\n\n` +
                                `✅ You are now a participant! Show up to get your stake back plus rewards!`;

                            await bot.sendMessage(chatId, successMessage, { parse_mode: 'Markdown' });

                        } catch (error) {
                            console.error('Error joining event:', error);
                            await bot.sendMessage(chatId, 
                                `❌ Failed to join event: ${error.message}`
                            );
                        }

                        // Clear join state
                        joinStates.delete(telegramId);
                    } else {
                        await bot.sendMessage(chatId, 
                            '❌ Please send "confirm" to join the event or "cancel" to abort.'
                        );
                    }
                    break;
            }
        }

    } catch (error) {
        console.error('Error in event flow:', error);
        await bot.sendMessage(msg.chat.id, 
            '❌ Sorry, there was an error. Please try again.'
        );
        userStates.delete(msg.from.id);
        joinStates.delete(msg.from.id);
    }
});
