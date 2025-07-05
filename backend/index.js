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

// Global helper function to escape special characters in wallet addresses for Markdown
const escapeWalletAddress = (address) => {
    if (!address) return '';
    return address.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&').replace(/[<>]/g, '\\$&');
};

// Global helper function to escape special characters in text for Markdown
const escapeMarkdown = (text) => {
    if (!text) return '';
    return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&').replace(/[<>]/g, '\\$&');
};

// Helper function to calculate distance between two coordinates (Haversine formula)
const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371; // Radius of the Earth in kilometers
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const distance = R * c; // Distance in kilometers
    return distance;
};

// Helper function to mark attendance on blockchain and database
const markAttendance = async (telegramId, eventId, chatId) => {
    try {
        // Get user data
        const userData = await getUserWallet(telegramId);
        if (!userData) {
            throw new Error('User wallet not found');
        }

        // Get event data
        const event = await getEventById(eventId);
        if (!event) {
            throw new Error('Event not found');
        }

        // Call smart contract to mark attendance on blockchain using bot wallet
        const config = require('./config');
        console.log('Marking attendance for event:', eventId, 'user wallet:', userData.wallet);
        
        if (!config.contract) {
            throw new Error('Contract not initialized properly');
        }
        
        const tx = await config.contract.markAttendance(eventId, userData.wallet);
        const receipt = await tx.wait();

        console.log('Blockchain transaction completed:', receipt.hash);

        // Update attendance in database
        const supabase = require('./model');
        const { error: updateError } = await supabase
            .from('participants')
            .update({ attended: true })
            .eq('event_id', eventId)
            .eq('wallet', userData.wallet);

        if (updateError) {
            console.error('Database update error:', updateError);
            throw new Error('Failed to update attendance in database');
        }

        console.log('Database updated successfully');

        return {
            success: true,
            txHash: receipt.hash,
            eventName: event.name
        };

    } catch (error) {
        console.error('Error marking attendance:', error);
        throw error;
    }
};





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
                `Wallet Address: \`${escapeWalletAddress(existingUser.wallet)}\`\n` +
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
            `🔑 Wallet Address: \`${escapeWalletAddress(walletData.address)}\`\n` +
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
            `🔑 Address: \`${escapeWalletAddress(userData.wallet)}\`\n` +
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
const attendanceStates = new Map();

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
                const escapedCreator = escapeWalletAddress(event.creator);
                const escapedName = escapeMarkdown(event.name);
                message += `${index + 1}. **${escapedName}**\n`;
                message += `   📅 ${eventDate}\n`;
                message += `   💰 Stake: ${event.stake_amount} ETH\n`;
                message += `   👤 Creator: \`${escapedCreator}\`\n`;
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
                const escapedCreator = escapeWalletAddress(event.creator);
                const escapedName = escapeMarkdown(event.name);
                message += `${index + 1}. **${escapedName}**\n`;
                message += `   📅 ${eventDate}\n`;
                message += `   💰 Stake: ${event.stake_amount} ETH\n`;
                message += `   👤 Creator: \`${escapedCreator}\`\n`;
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

        // Debug: Log the message to see what's being sent
        console.log('Events message length:', message.length);
        console.log('Events message preview:', message.substring(0, 200) + '...');
        
        // Try without Markdown first to see if the issue is with parsing
        try {
            await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        } catch (markdownError) {
            console.error('Markdown parsing failed, trying without Markdown:', markdownError.message);
            // Remove Markdown formatting and send as plain text
            const plainMessage = message
                .replace(/\*\*/g, '') // Remove bold
                .replace(/`/g, '') // Remove code blocks
                .replace(/\\/g, ''); // Remove escape characters
            await bot.sendMessage(chatId, plainMessage);
        }

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
                        `• Creator: \`${escapeWalletAddress(userData.wallet)}\`\n\n` +
                        `🔗 **Blockchain Info:**\n` +
                        `• Event ID: \`${result.eventId}\`\n` +
                        `• Transaction: \`${escapeWalletAddress(result.txHash)}\`\n` +
                        `• Bot Wallet: \`${escapeWalletAddress(result.botWallet)}\`\n\n` +
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



        // Handle attendance confirmation flow (location sharing)
        const attendanceState = attendanceStates.get(telegramId);
        if (attendanceState && !msg.text?.startsWith('/')) {
            try {
                const { step, data } = attendanceState;

                if (step === 'location') {
                    // Check if it's a location message
                    if (msg.location) {
                        const userLat = msg.location.latitude;
                        const userLng = msg.location.longitude;
                        
                        // Get event location
                        const event = data.selectedEvent;
                        
                        // Display event ID and coordinates
                        let message = 
                            `📅 **Event ID:** \`${event.id}\`\n\n` +
                            `📍 **Your Location:**\n` +
                            `• Latitude: \`${userLat}\`\n` +
                            `• Longitude: \`${userLng}\`\n\n` +
                            `📅 **Event Details:**\n` +
                            `• Name: ${escapeMarkdown(event.name)}\n` +
                            `• Date: ${new Date(event.date).toLocaleString()}\n` +
                            `• Stake: ${event.stake_amount} ETH`;

                        // Check if event has location coordinates
                        if (event.location_lat && event.location_lng) {
                            // Calculate distance between user and event location
                            const distance = calculateDistance(
                                userLat, userLng,
                                event.location_lat, event.location_lng
                            );
                            
                            message += `\n\n📍 **Distance Check:**\n`;
                            message += `• Distance from event: ${distance.toFixed(3)} km\n`;
                            message += `• Required: Within 0.2 km (200 meters)\n`;
                            
                            if (distance <= 0.2) { // 200 meters = 0.2 km
                                // User is within 100 meters, mark attendance
                                try {
                                    const result = await markAttendance(telegramId, event.id, chatId);
                                    
                                    message += `\n\n✅ **Attendance Confirmed!**\n`;
                                    message += `🎉 Your attendance has been marked on the blockchain!\n`;
                                    message += `🔗 Transaction: \`${escapeWalletAddress(result.txHash)}\``;
                                    
                                } catch (attendanceError) {
                                    message += `\n\n❌ **Failed to mark attendance:** ${attendanceError.message}`;
                                }
                            } else {
                                message += `\n\n❌ **Location too far!**\n`;
                                message += `Please move closer to the event location and try again.`;
                            }
                        } else {
                            // Event doesn't have location coordinates, just mark attendance
                            try {
                                const result = await markAttendance(telegramId, event.id, chatId);
                                
                                message += `\n\n✅ **Attendance Confirmed!**\n`;
                                message += `🎉 Your attendance has been marked on the blockchain!\n`;
                                message += `🔗 Transaction: \`${escapeWalletAddress(result.txHash)}\``;
                                
                            } catch (attendanceError) {
                                message += `\n\n❌ **Failed to mark attendance:** ${attendanceError.message}`;
                            }
                        }

                        await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
                        
                        // Clear attendance state
                        attendanceStates.delete(telegramId);
                    } else {
                        await bot.sendMessage(chatId, 
                            '❌ Please share your location using the 📎 attachment button and selecting "Location".'
                        );
                    }
                }
            } catch (error) {
                console.error('Error in attendance confirmation flow:', error);
                await bot.sendMessage(chatId, 
                    '❌ Sorry, there was an error processing your location. Please try again.'
                );
                attendanceStates.delete(telegramId);
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
                            `👤 Creator: \`${escapeWalletAddress(event.creator)}\`\n\n` +
                            `⚠️ **Important:** Joining this event will stake ${event.stake_amount} ETH from your wallet.\n\n` +
                            `Click the button below to confirm:`;

                        await bot.sendMessage(chatId, message, {
                            parse_mode: 'Markdown',
                            reply_markup: {
                                inline_keyboard: [
                                    [
                                        { text: '✅ Join Event', callback_data: `join_confirm_${event.id}` },
                                        { text: '❌ Cancel', callback_data: 'join_cancel' }
                                    ]
                                ]
                            }
                        });
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
                        message += `Select an event to join:`;

                        // Create inline keyboard with event options
                        const keyboard = events.map((event, index) => [
                            { text: `${index + 1}. ${event.name}`, callback_data: `select_event_${event.id}` }
                        ]);
                        keyboard.push([{ text: '❌ Cancel', callback_data: 'join_cancel' }]);

                        await bot.sendMessage(chatId, message, {
                            parse_mode: 'Markdown',
                            reply_markup: {
                                inline_keyboard: keyboard
                            }
                        });
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
                        `👤 Creator: \`${escapeWalletAddress(selectedEvent.creator)}\`\n\n` +
                        `⚠️ **Important:** Joining this event will stake ${selectedEvent.stake_amount} ETH from your wallet.\n\n` +
                        `Click the button below to confirm:`;

                    await bot.sendMessage(chatId, message, {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    { text: '✅ Join Event', callback_data: `join_confirm_${selectedEvent.id}` },
                                    { text: '❌ Cancel', callback_data: 'join_cancel' }
                                ]
                            ]
                        }
                    });
                    break;


            }
        }

    } catch (error) {
        console.error('Error in event flow:', error);
        await bot.sendMessage(msg.chat.id, 
            '❌ Sorry, there was an error. Please try again.'
        );
        userStates.delete(telegramId);
        joinStates.delete(telegramId);
    }
});

// Handle /help command
bot.onText(/\/help/, async (msg) => {
    try {
        const chatId = msg.chat.id;
        
        const helpMessage = 
            `🤖 **MeetUp Bot Commands**\n\n` +
            `**Wallet Management:**\n` +
            `• /create_wallet - Create a new wallet\n` +
            `• /wallet - View your wallet details and balance\n\n` +
            `**Event Management:**\n` +
            `• /create_event - Create a new event\n` +
            `• /events - List all available and joined events\n` +
            `• /join_event - Join an existing event\n` +
            `• /confirm_attendance - View your joined events and attendance status\n` +
            `• /end_event - End your created events (creators only)\n\n` +
            `**How it works:**\n` +
            `1. Create a wallet with /create_wallet\n` +
            `2. Create events with /create_event or join existing ones with /join_event\n` +
            `3. Use /confirm_attendance to view your joined events\n` +
            `4. Show up to events to get your stake back plus rewards!`;

        await bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });

    } catch (error) {
        console.error('Error in help handler:', error);
        await bot.sendMessage(msg.chat.id, 
            '❌ Sorry, there was an error. Please try again later.'
        );
    }
});



// Handle /end_event command (for event creators to finalize events)
bot.onText(/\/end_event/, async (msg) => {
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

        // Get events created by this user
        const supabase = require('./model');
        const { data: createdEvents, error } = await supabase
            .from('events')
            .select('*')
            .eq('creator', userData.wallet)
            .eq('finalized', false)
            .order('date', { ascending: true });

        if (error) {
            console.error('Database error:', error);
            await bot.sendMessage(chatId, 
                '❌ Sorry, there was an error retrieving your events. Please try again later.'
            );
            return;
        }

        if (!createdEvents || createdEvents.length === 0) {
            await bot.sendMessage(chatId, 
                '❌ You haven\'t created any active events yet. Use /create_event to create one!'
            );
            return;
        }

        // Show list of created events with clickable buttons
        let message = '🏁 **Your Created Events**\n\n';
        
        createdEvents.forEach((event, index) => {
            const eventDate = new Date(event.date).toLocaleString();
            const escapedName = escapeMarkdown(event.name);
            message += `${index + 1}. **${escapedName}**\n`;
            message += `   📅 ${eventDate}\n`;
            message += `   💰 Stake: ${event.stake_amount} ETH\n`;
            message += `   ${event.finalized ? '✅ Finalized' : '⏳ Active'}\n\n`;
        });

        message += 'Click on an event to get its ID:';

        // Create inline keyboard with event options
        const keyboard = createdEvents.map((event, index) => [
            { text: `${index + 1}. ${event.name}`, callback_data: `end_event_${event.id}` }
        ]);

        await bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: keyboard
            }
        });

    } catch (error) {
        console.error('Error listing created events:', error);
        await bot.sendMessage(msg.chat.id, 
            '❌ Sorry, there was an error. Please try again later.'
        );
    }
});

// Handle /confirm_attendance command (for participants to confirm their attendance)
bot.onText(/\/confirm_attendance/, async (msg) => {
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

        // Get events joined by this user
        const joinedEvents = await getJoinedEvents(telegramId);
        
        if (!joinedEvents || joinedEvents.length === 0) {
            await bot.sendMessage(chatId, 
                '❌ You haven\'t joined any events yet. Use /join_event to join an event first!'
            );
            return;
        }

        // Show list of joined events with clickable buttons
        let message = '📍 **Your Joined Events**\n\n';
        
        joinedEvents.forEach((joined, index) => {
            const event = joined.events;
            const eventDate = new Date(event.date).toLocaleString();
            const escapedName = escapeMarkdown(event.name);
            message += `${index + 1}. **${escapedName}**\n`;
            message += `   📅 ${eventDate}\n`;
            message += `   💰 Stake: ${event.stake_amount} ETH\n`;
            message += `   ${joined.attended ? '✅ Attended' : '⏳ Not Attended'}\n\n`;
        });

        message += 'Click on an event to get its ID:';

        // Create inline keyboard with event options
        const keyboard = joinedEvents.map((joined, index) => [
            { text: `${index + 1}. ${joined.events.name}`, callback_data: `event_id_${joined.events.id}` }
        ]);

        await bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: keyboard
            }
        });

    } catch (error) {
        console.error('Error listing joined events:', error);
        await bot.sendMessage(msg.chat.id, 
            '❌ Sorry, there was an error. Please try again later.'
        );
    }
});

// Handle inline button callbacks
bot.on('callback_query', async (callbackQuery) => {
    // Declare telegramId at function scope so it's available in catch block
    let telegramId = null;
    let userName = 'User';
    
    try {
        console.log('Received callback query:', JSON.stringify(callbackQuery, null, 2));
        
        const data = callbackQuery.data;
        const chatId = callbackQuery.message.chat.id;
        
        // Safely get telegramId
        
        if (callbackQuery.from && callbackQuery.from.id) {
            telegramId = callbackQuery.from.id;
            userName = callbackQuery.from.first_name || callbackQuery.from.username || 'User';
        } else if (callbackQuery.message && callbackQuery.message.from && callbackQuery.message.from.id) {
            // Fallback: try to get from the original message
            telegramId = callbackQuery.message.from.id;
            userName = callbackQuery.message.from.first_name || callbackQuery.message.from.username || 'User';
        } else {
            console.error('Callback query missing from field:', callbackQuery);
            console.error('Callback query structure:', Object.keys(callbackQuery));
            await bot.sendMessage(chatId, '❌ Error: Could not identify user. Please try again.');
            return;
        }

        // Answer the callback query to remove loading state
        await bot.answerCallbackQuery(callbackQuery.id);

        if (data === 'join_cancel') {
            await bot.sendMessage(chatId, '❌ Event joining cancelled.');
            joinStates.delete(telegramId);
            return;
        }

        if (data.startsWith('event_id_')) {
            const eventId = data.replace('event_id_', '');
            
            // Get event details
            const event = await getEventById(eventId);
            if (!event) {
                await bot.sendMessage(chatId, '❌ Event not found. Please try again.');
                return;
            }

            // Store event data for location step
            attendanceStates.set(telegramId, {
                step: 'location',
                data: { selectedEvent: event }
            });

            const eventDate = new Date(event.date).toLocaleString();
            const message = 
                `📅 **Event Selected:** ${escapeMarkdown(event.name)}\n\n` +
                `📅 Date: ${eventDate}\n` +
                `💰 Stake: ${event.stake_amount} ETH\n` +
                `📍 Event Location: ${event.location_lat && event.location_lng ? 'Location shared via Telegram' : 'Manual location'}\n\n` +
                `📍 **Share Your Current Location**\n` +
                `Please share your current location so I can verify you're at the event.\n\n` +
                `**How to share location:**\n` +
                `• Tap the 📎 attachment button\n` +
                `• Select "Location"\n` +
                `• Choose "Send your current location"`;

            await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
            return;
        }

        if (data.startsWith('end_event_')) {
            const eventId = parseInt(data.replace('end_event_', ''));
            
            await bot.sendMessage(chatId, '⏳ Finalizing event... Please wait.');
            
            try {
                // Call smart contract to finalize event using bot wallet
                const config = require('./config');
                console.log('Finalizing event:', eventId);
                
                if (!config.contract) {
                    throw new Error('Contract not initialized properly');
                }
                
                const tx = await config.contract.finalizeEvent(eventId);
                const receipt = await tx.wait();

                console.log('Event finalized on blockchain:', receipt.hash);

                // Update event status in database
                const supabase = require('./model');
                const { error: updateError } = await supabase
                    .from('events')
                    .update({ finalized: true })
                    .eq('id', eventId);

                if (updateError) {
                    console.error('Database update error:', updateError);
                    throw new Error('Failed to update event status in database');
                }

                console.log('Event status updated in database');

                // Get event details and participants
                const event = await getEventById(eventId);
                const { data: participants, error: participantsError } = await supabase
                    .from('participants')
                    .select(`
                        wallet,
                        attended,
                        users (
                            telegram_name
                        )
                    `)
                    .eq('event_id', eventId);

                if (participantsError) {
                    console.error('Error fetching participants:', participantsError);
                    throw new Error('Failed to fetch event participants');
                }

                // Generate event summary
                const eventDate = new Date(event.date).toLocaleString();
                const totalParticipants = participants.length;
                const attendedParticipants = participants.filter(p => p.attended).length;
                const notAttendedParticipants = totalParticipants - attendedParticipants;

                let summaryMessage = 
                    `🏁 **Event Finalized Successfully!**\n\n` +
                    `📅 **Event Details:**\n` +
                    `• Name: ${escapeMarkdown(event.name)}\n` +
                    `• Date: ${eventDate}\n` +
                    `• Stake: ${event.stake_amount} ETH\n` +
                    `• Creator: \`${escapeWalletAddress(event.creator)}\`\n\n` +
                    `📊 **Attendance Summary:**\n` +
                    `• Total Participants: ${totalParticipants}\n` +
                    `• Attended: ${attendedParticipants}\n` +
                    `• Not Attended: ${notAttendedParticipants}\n\n` +
                    `🔗 **Transaction:** \`${escapeWalletAddress(receipt.hash)}\`\n\n`;

                if (participants.length > 0) {
                    summaryMessage += `👥 **Participants:**\n`;
                    participants.forEach((participant, index) => {
                        const userName = participant.users?.telegram_name || 'Unknown User';
                        const status = participant.attended ? '✅ Attended' : '❌ Not Attended';
                        summaryMessage += `${index + 1}. ${userName} - ${status}\n`;
                    });
                }

                await bot.sendMessage(chatId, summaryMessage, { parse_mode: 'Markdown' });

            } catch (error) {
                console.error('Error finalizing event:', error);
                await bot.sendMessage(chatId, 
                    `❌ Failed to finalize event: ${error.message}`
                );
            }
            return;
        }



        if (data.startsWith('select_event_')) {
            const eventId = parseInt(data.replace('select_event_', ''));
            const event = await getEventById(eventId);
            
            if (!event) {
                await bot.sendMessage(chatId, '❌ Event not found. Please try again.');
                joinStates.delete(telegramId);
                return;
            }

            const eventDate = new Date(event.date).toLocaleString();

            const message = 
                `📅 **Event Selected:** ${event.name}\n\n` +
                `📅 Date: ${eventDate}\n` +
                `💰 Stake Amount: ${event.stake_amount} ETH\n` +
                `👤 Creator: \`${escapeWalletAddress(event.creator)}\`\n\n` +
                `⚠️ **Important:** Joining this event will stake ${event.stake_amount} ETH from your wallet.\n\n` +
                `Click the button below to confirm:`;

            await bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '✅ Join Event', callback_data: `join_confirm_${event.id}` },
                            { text: '❌ Cancel', callback_data: 'join_cancel' }
                        ]
                    ]
                }
            });
            return;
        }



        if (data.startsWith('join_confirm_')) {
            const eventId = parseInt(data.replace('join_confirm_', ''));
            
            await bot.sendMessage(chatId, '⏳ Joining event... Please wait.');
            
            try {
                const result = await joinEvent(telegramId, eventId);
                
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
            return;
        }

    } catch (error) {
        console.error('Error handling callback query:', error);
        await bot.sendMessage(callbackQuery.message.chat.id, 
            '❌ Sorry, there was an error. Please try again.'
        );
        // Safely delete states if telegramId is available
        try {
            if (telegramId) {
                joinStates.delete(telegramId);
                attendanceStates.delete(telegramId);
            }
        } catch (cleanupError) {
            console.error('Error during cleanup:', cleanupError);
        }
    }
});
