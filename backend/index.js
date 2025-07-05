require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { createWallet, getUserWallet, getWalletBalance, createEvent, getEvents, getJoinedEvents, getEventByName, getEventById, joinEvent } = require('./contract');

// Get token from environment variable
const token = process.env.token;
const TOKENNAME = process.env.TOKENNAME || 'ETH'; // Default to ETH if not set
const CHAINNAME = process.env.CHAINNAME || 'base-sepolia'; // Default to base-sepolia if not set
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

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

// Helper function to call OpenAI Image Edit API
const createMemoryPoster = async (fileId, eventName, eventDate) => {
    try {
        if (!OPENAI_API_KEY) {
            throw new Error('OpenAI API key not configured');
        }

        // Import OpenAI SDK
        const OpenAI = require('openai');
        const client = new OpenAI({
            apiKey: OPENAI_API_KEY
        });

        // Get file info from Telegram
        const fileInfo = await bot.getFile(fileId);
        if (!fileInfo || !fileInfo.file_path) {
            throw new Error('Failed to get file info from Telegram');
        }

        // Construct the full file URL
        const fileUrl = `https://api.telegram.org/file/bot${token}/${fileInfo.file_path}`;
        
        // Download the image from Telegram
        const response = await fetch(fileUrl);
        if (!response.ok) {
            throw new Error('Failed to download image from Telegram');
        }
        
        const imageBuffer = await response.arrayBuffer();

        // Create the prompt based on event details
        const formattedDate = new Date(eventDate).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });

        const prompt = `Transform this group photo into a beautiful travel memory poster. Create a vintage travel scrapbook design with the following elements:

1. Use the uploaded group photo as the main centerpiece
2. Add a decorative title at the top: "${eventName} 🌊 2025" in stylish, handwritten font
3. Include the date below: "${formattedDate}" in elegant typography
4. Frame the photo with playful travel-themed decorations:
   - Polaroid-style photo frames with rounded corners
   - Travel stickers and emojis (🌴☀️🎒📸✈️🏖️)
   - Handwritten-style labels and doodles
   - Paper textures and tape corners
5. Add beach and travel elements in the background:
   - Subtle waves, sand, shells, palm trees
   - Warm, golden hour lighting
   - Faded travel map elements
6. Maintain the original faces and expressions of people in the photo
7. Create a warm, nostalgic color palette with pastel tones
8. Make it look like a professional memory poster suitable for framing

The overall design should capture the joy and excitement of group travel memories while preserving the authenticity of the original photo.`;

        // Process image to meet OpenAI requirements
        const { createCanvas, loadImage } = require('canvas');
        
        // Load the image
        const image = await loadImage(Buffer.from(imageBuffer));
        
        // Create a square canvas (1024x1024 as required by OpenAI)
        const canvas = createCanvas(1024, 1024);
        const ctx = canvas.getContext('2d');
        
        // Calculate dimensions to maintain aspect ratio and center the image
        const maxSize = 1024;
        const scale = Math.min(maxSize / image.width, maxSize / image.height);
        const scaledWidth = image.width * scale;
        const scaledHeight = image.height * scale;
        const x = (maxSize - scaledWidth) / 2;
        const y = (maxSize - scaledHeight) / 2;
        
        // Fill background with white
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, maxSize, maxSize);
        
        // Draw the image centered and scaled
        ctx.drawImage(image, x, y, scaledWidth, scaledHeight);
        
        // Convert to PNG buffer
        const pngBuffer = canvas.toBuffer('image/png');

        // Create a temporary file for the processed image
        const fs = require('fs');
        const path = require('path');
        const tempImagePath = path.join(__dirname, 'temp_image.png');
        fs.writeFileSync(tempImagePath, pngBuffer);

        // Use OpenAI SDK with GPT-Image-1 for image editing
        const { toFile } = require('openai');
        
        // Create file object for OpenAI
        const imageFile = await toFile(fs.createReadStream(tempImagePath), null, {
            type: "image/png",
        });

        // Call OpenAI Image Edit API
        const rsp = await client.images.edit({
            model: "gpt-image-1",
            image: [imageFile],
            prompt: prompt,
            size: "1024x1024",
            n: 1
        });

        // Clean up temporary file
        fs.unlinkSync(tempImagePath);

        if (!rsp.data || rsp.data.length === 0) {
            throw new Error('No image generated from OpenAI API');
        }

        // The response contains base64-encoded image data
        const image_base64 = rsp.data[0].b64_json;
        const image_bytes = Buffer.from(image_base64, "base64");
        
        // Save the enhanced image to a temporary file
        const enhancedImagePath = path.join(__dirname, 'enhanced_image.png');
        fs.writeFileSync(enhancedImagePath, image_bytes);
        
        // Compress the image before uploading to Walrus
        const sharp = require('sharp');
        
        // Compress image using sharp
        const compressedImagePath = path.join(__dirname, 'compressed_image.jpg');
        await sharp(enhancedImagePath)
            .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .toFile(compressedImagePath);
        
        // Upload the compressed image to Walrus
        const { uploadFileToWalrus, getWalrusUrl } = require('./walrus');
        const blobId = await uploadFileToWalrus(compressedImagePath, { epochs: 10 }); // Store for 10 epochs
        
        // Clean up temporary files
        fs.unlinkSync(enhancedImagePath);
        fs.unlinkSync(compressedImagePath);
        
        return {
            type: 'enhanced',
            blobId: blobId,
            walrusUrl: getWalrusUrl(blobId),
            imageBuffer: image_bytes, // Keep original for immediate sending
            message: '✨ Your photo has been transformed into a beautiful AI-enhanced memory poster and stored on Walrus!'
        };

    } catch (error) {
        console.error('Error creating memory poster:', error);
        throw error;
    }
};

// Helper function to mark attendance on blockchain and database
const markAttendance = async (telegramId, eventId, chatId) => {
    try {
        console.log('markAttendance called with:', { telegramId, eventId, chatId });
        
        // Get user data
        const userData = await getUserWallet(telegramId);
        if (!userData) {
            console.error('User wallet not found for telegramId:', telegramId);
            throw new Error('User wallet not found');
        }
        console.log('User data retrieved:', { wallet: userData.wallet, name: userData.telegram_name });

        // Get event data
        const event = await getEventById(eventId);
        if (!event) {
            console.error('Event not found for eventId:', eventId);
            throw new Error('Event not found');
        }
        console.log('Event data retrieved:', { name: event.name, finalized: event.finalized });

        // Call smart contract to mark attendance on blockchain using bot wallet
        const config = require('./config');
        console.log('Marking attendance for event:', eventId, 'user wallet:', userData.wallet);
        
        if (!config.contract) {
            console.error('Contract not initialized properly');
            throw new Error('Contract not initialized properly');
        }
        
        console.log('Calling smart contract markAttendance...');
        const tx = await config.contract.markAttendance(eventId, userData.wallet);
        console.log('Transaction sent, waiting for receipt...');
        const receipt = await tx.wait();

        console.log('Blockchain transaction completed:', receipt.hash);

        // Update attendance in database
        const supabase = require('./model');
        console.log('Updating database attendance...');
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
            `💎 Balance: ${balance} ${TOKENNAME}`;

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
const attendanceStates = new Map();
const memoryStates = new Map();

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
        
        // Show available events (events not joined by user)
        const availableEvents = allEvents.filter(event => 
            !joinedEvents.some(joined => joined.events.id === event.id)
        );

        if (allEvents.length === 0) {
            await bot.sendMessage(chatId, 
                '📅 **No events found.**\n\nCreate one with /create_event!',
                { parse_mode: 'Markdown' }
            );
            return;
        }

        // Store events in user state for navigation
        userStates.set(telegramId, {
            step: 'browsing_events',
            data: {
                allEvents: allEvents,
                availableEvents: availableEvents,
                joinedEvents: joinedEvents,
                currentIndex: 0,
                currentType: 'all' // 'all', 'available', 'joined'
            }
        });

        // Show first event
        await showEventSlide(chatId, telegramId, 0, 'all');

    } catch (error) {
        console.error('Error listing events:', error);
        await bot.sendMessage(msg.chat.id, 
            '❌ Sorry, there was an error retrieving events. Please try again later.'
        );
    }
});

// Helper function to show a single event slide
async function showEventSlide(chatId, telegramId, index, type) {
    try {
        const userState = userStates.get(telegramId);
        if (!userState || userState.step !== 'browsing_events') {
            return;
        }

        const { allEvents, availableEvents, joinedEvents } = userState.data;
        let events, eventType;
        
        switch (type) {
            case 'available':
                events = availableEvents;
                eventType = 'Available Events';
                break;
            case 'joined':
                events = joinedEvents;
                eventType = 'Your Joined Events';
                break;
            default:
                events = allEvents;
                eventType = 'All Events';
        }

        if (!events || events.length === 0) {
            await bot.sendMessage(chatId, 
                `📅 **No ${eventType.toLowerCase()} found.**`,
                { parse_mode: 'Markdown' }
            );
            return;
        }

        if (index >= events.length) {
            index = 0;
        }
        if (index < 0) {
            index = events.length - 1;
        }

        const event = type === 'joined' ? events[index].events : events[index];
        const eventDate = new Date(event.date).toLocaleString();
        const escapedCreator = escapeWalletAddress(event.creator);
        const escapedName = escapeMarkdown(event.name);
        
        let message = `📅 **${eventType}**\n\n`;
        message += `**${escapedName}**\n`;
        message += `📅 Date: ${eventDate}\n`;
        message += `💰 Stake: ${event.stake_amount} ${TOKENNAME}\n`;
        message += `👤 Creator: \`${escapedCreator}\`\n`;
        
        if (type === 'joined') {
            const joinedEvent = events[index];
            message += `Status: ${joinedEvent.attended ? '✅ Attended' : '⏳ Not Attended'}\n`;
            message += `Event: ${event.finalized ? '🏁 Finalized' : '🔄 Active'}\n`;
        } else {
            message += `Status: ${event.finalized ? '✅ Finalized' : '⏳ Active'}\n`;
        }
        
        message += `\n📄 ${index + 1} of ${events.length}`;

        // Create navigation keyboard
        const keyboard = [];
        
        // Navigation row
        const navRow = [];
        if (events.length > 1) {
            navRow.push({ text: '⬅️ Previous', callback_data: `event_nav_${type}_${index - 1}` });
            navRow.push({ text: 'Next ➡️', callback_data: `event_nav_${type}_${index + 1}` });
        }
        keyboard.push(navRow);
        
        // Type selector row
        const typeRow = [];
        typeRow.push({ text: '📋 All', callback_data: `event_type_all_${index}` });
        typeRow.push({ text: '🎯 Available', callback_data: `event_type_available_${index}` });
        typeRow.push({ text: '🎉 Joined', callback_data: `event_type_joined_${index}` });
        keyboard.push(typeRow);
        
        // Action row
        const actionRow = [];
        if (type === 'available' && !event.finalized) {
            actionRow.push({ text: '🎉 Join Event', callback_data: `select_event_${event.id}` });
        }
        if (type === 'joined' && !event.finalized && !events[index].attended) {
            actionRow.push({ text: '📍 Confirm Attendance', callback_data: `event_id_${event.id}` });
        }
        if (actionRow.length > 0) {
            keyboard.push(actionRow);
        }
        
        // Close button
        keyboard.push([{ text: '❌ Close', callback_data: 'close_events' }]);

        // Update user state
        userState.data.currentIndex = index;
        userState.data.currentType = type;
        userStates.set(telegramId, userState);

        await bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: keyboard
            }
        });

    } catch (error) {
        console.error('Error showing event slide:', error);
        await bot.sendMessage(chatId, 
            '❌ Sorry, there was an error showing the event. Please try again.'
        );
    }
}

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

        // Get all available events
        const allEvents = await getEvents();
        
        // Get events joined by this user
        const joinedEvents = await getJoinedEvents(telegramId);
        
        // Filter out events already joined by user
        const availableEvents = allEvents.filter(event => 
            !joinedEvents.some(joined => joined.events.id === event.id) && !event.finalized
        );

        if (availableEvents.length === 0) {
            await bot.sendMessage(chatId, 
                '❌ No available events to join. All events are either finalized or you have already joined them.\n\n' +
                'Use /create_event to create a new event!'
            );
            return;
        }

        // Store events in user state for navigation
        userStates.set(telegramId, {
            step: 'browsing_join_events',
            data: {
                availableEvents: availableEvents,
                currentIndex: 0
            }
        });

        // Show first available event
        await showJoinEventSlide(chatId, telegramId, 0);

    } catch (error) {
        console.error('Error starting event joining:', error);
        await bot.sendMessage(msg.chat.id, 
            '❌ Sorry, there was an error. Please try again later.'
        );
    }
});

// Helper function to show a single join event slide
async function showJoinEventSlide(chatId, telegramId, index) {
    try {
        const userState = userStates.get(telegramId);
        if (!userState || userState.step !== 'browsing_join_events') {
            return;
        }

        const { availableEvents } = userState.data;

        if (!availableEvents || availableEvents.length === 0) {
            await bot.sendMessage(chatId, 
                '❌ No available events to join.',
                { parse_mode: 'Markdown' }
            );
            return;
        }

        if (index >= availableEvents.length) {
            index = 0;
        }
        if (index < 0) {
            index = availableEvents.length - 1;
        }

        const event = availableEvents[index];
        const eventDate = new Date(event.date).toLocaleString();
        const escapedCreator = escapeWalletAddress(event.creator);
        const escapedName = escapeMarkdown(event.name);
        
        let message = `🎉 **Available Events to Join**\n\n`;
        message += `**${escapedName}**\n`;
        message += `📅 Date: ${eventDate}\n`;
        message += `💰 Stake: ${event.stake_amount} ${TOKENNAME}\n`;
        message += `👤 Creator: \`${escapedCreator}\`\n`;
        message += `Status: ⏳ Active\n`;
        message += `\n📄 ${index + 1} of ${availableEvents.length}`;

        // Create navigation keyboard
        const keyboard = [];
        
        // Navigation row
        const navRow = [];
        if (availableEvents.length > 1) {
            navRow.push({ text: '⬅️ Previous', callback_data: `join_nav_${index - 1}` });
            navRow.push({ text: 'Next ➡️', callback_data: `join_nav_${index + 1}` });
        }
        keyboard.push(navRow);
        
        // Action row
        keyboard.push([
            { text: '🎉 Join Event', callback_data: `select_event_${event.id}` }
        ]);
        
        // Close button
        keyboard.push([{ text: '❌ Cancel', callback_data: 'join_cancel' }]);

        // Update user state
        userState.data.currentIndex = index;
        userStates.set(telegramId, userState);

        await bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: keyboard
            }
        });

    } catch (error) {
        console.error('Error showing join event slide:', error);
        await bot.sendMessage(chatId, 
            '❌ Sorry, there was an error showing the event. Please try again.'
        );
    }
}

// Handle all messages including location
bot.on('message', async (msg) => {
    console.log('=== MESSAGE RECEIVED ===');
    console.log('Message type:', typeof msg);
    console.log('Message keys:', Object.keys(msg));
    console.log('From user:', msg.from?.id, msg.from?.first_name);
    console.log('Chat ID:', msg.chat?.id);
    console.log('Has text:', !!msg.text);
    console.log('Has location:', !!msg.location);
    console.log('Has photo:', !!msg.photo);
    console.log('Text content:', msg.text || 'No text');
    
    if (msg.location) {
        console.log('=== LOCATION MESSAGE DETECTED ===');
        console.log('Location data:', msg.location);
    }
    try {
        const chatId = msg.chat.id;
        const telegramId = msg.from.id;
        const userState = userStates.get(telegramId);

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
                        `How much ${TOKENNAME} should participants stake to join?\n` +
                        `Please send a number (e.g., \`0.01\` for 0.01 ${TOKENNAME}):`,
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
                            `• Stake: ${data.stakeAmount} ${TOKENNAME}\n` +
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

        // Handle memory creation flow (photo upload) - REMOVED since we have dedicated photo handler
        // Photo handling is now done in the dedicated bot.on('photo', ...) handler

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
                            `• Stake: ${event.stake_amount} ${TOKENNAME}`;

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
                                // User is within 200 meters, mark attendance
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

    } catch (error) {
        console.error('Error in event flow:', error);
        await bot.sendMessage(msg.chat.id, 
            '❌ Sorry, there was an error. Please try again.'
        );
        // Safely delete states if telegramId is available
        try {
            if (telegramId) {
                userStates.delete(telegramId);
                memoryStates.delete(telegramId);
            }
        } catch (cleanupError) {
            console.error('Error during cleanup:', cleanupError);
        }
    }
});

// Handle photo messages specifically
bot.on('photo', async (msg) => {
    console.log('=== PHOTO EVENT TRIGGERED ===');
    console.log('Photo message:', msg);
    
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    
    // Check if user has memory state
    const memoryState = memoryStates.get(telegramId);
    if (memoryState && memoryState.step === 'photo_upload') {
        console.log('=== PROCESSING PHOTO FOR MEMORY ===');
        try {
            const { data } = memoryState;
            const photo = msg.photo[msg.photo.length - 1]; // Get the highest quality photo
            const caption = msg.caption || '';
            
            // Get event details
            const event = data.selectedEvent;
            
            // Send processing message
            await bot.sendMessage(chatId, 
                '🎨 **Creating your memory poster...**\n\n' +
                '⏳ Please wait while I enhance your photo with AI magic!'
            );
            
            try {
                // Create memory poster (currently returns original image)
                const result = await createMemoryPoster(photo.file_id, event.name, event.date);
                
                // Save memory to database with Walrus blob ID
                const supabase = require('./model');
                const { data: memoryData, error: memoryError } = await supabase
                    .from('memory_posters')
                    .insert([{
                        event_id: event.id,
                        image_url: result.walrusUrl,
                        blob_id: result.blobId,
                        created_at: new Date().toISOString()
                    }])
                    .select();

                if (memoryError) {
                    console.error('Database error saving memory:', memoryError);
                    throw new Error('Failed to save memory to database');
                }

                // Send success message
                const successMessage = 
                    `🎨 **AI-Enhanced Memory Poster Created!**\n\n` +
                    `📅 **Event:** ${escapeMarkdown(event.name)}\n` +
                    `📅 Date: ${new Date(event.date).toLocaleString()}\n` +
                    `💰 Stake: ${event.stake_amount} ${TOKENNAME}\n` +
                    `👤 Creator: \`${escapeWalletAddress(event.creator)}\`\n\n` +
                    `✨ ${result.message}`;

                // Send the enhanced image using buffer
                await bot.sendPhoto(chatId, result.imageBuffer, {
                    caption: successMessage,
                    parse_mode: 'Markdown'
                });
                
            } catch (apiError) {
                console.error('Error creating enhanced memory poster:', apiError);
                
                // Fallback: save original photo to Walrus if OpenAI API fails
                const { uploadFileToWalrus, getWalrusUrl } = require('./walrus');
                
                // Get original photo from Telegram
                const fileInfo = await bot.getFile(photo.file_id);
                const fileUrl = `https://api.telegram.org/file/bot${token}/${fileInfo.file_path}`;
                const response = await fetch(fileUrl);
                const imageBuffer = await response.arrayBuffer();
                
                // Save to temporary file
                const tempImagePath = path.join(__dirname, 'temp_original.png');
                fs.writeFileSync(tempImagePath, Buffer.from(imageBuffer));
                
                // Compress image before uploading to Walrus
                const sharp = require('sharp');
                const compressedImagePath = path.join(__dirname, 'temp_compressed.jpg');
                await sharp(tempImagePath)
                    .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
                    .jpeg({ quality: 80 })
                    .toFile(compressedImagePath);
                
                // Upload compressed image to Walrus
                const blobId = await uploadFileToWalrus(compressedImagePath, { epochs: 10 });
                const walrusUrl = getWalrusUrl(blobId);
                
                // Clean up
                fs.unlinkSync(tempImagePath);
                fs.unlinkSync(compressedImagePath);
                
                const supabase = require('./model');
                const { data: memoryData, error: memoryError } = await supabase
                    .from('memory_posters')
                    .insert([{
                        event_id: event.id,
                        image_url: walrusUrl,
                        blob_id: blobId,
                        created_at: new Date().toISOString()
                    }])
                    .select();

                if (memoryError) {
                    console.error('Database error saving memory:', memoryError);
                    throw new Error('Failed to save memory to database');
                }

                // Send fallback message with original photo
                const fallbackMessage = 
                    `📸 **Memory Saved (Original Photo)**\n\n` +
                    `📅 **Event:** ${escapeMarkdown(event.name)}\n` +
                    `📅 Date: ${new Date(event.date).toLocaleString()}\n` +
                    `💰 Stake: ${event.stake_amount} ${TOKENNAME}\n` +
                    `👤 Creator: \`${escapeWalletAddress(event.creator)}\`\n\n` +
                    `⚠️ AI enhancement failed, but your original photo has been saved as a memory.`;

                await bot.sendPhoto(chatId, Buffer.from(imageBuffer), {
                    caption: fallbackMessage,
                    parse_mode: 'Markdown'
                });
            }
            
            // Clear memory state
            memoryStates.delete(telegramId);
        } catch (error) {
            console.error('Error processing photo for memory:', error);
            await bot.sendMessage(chatId, 
                '❌ Sorry, there was an error processing your photo. Please try again.'
            );
            memoryStates.delete(telegramId);
        }
    } else {
        console.log('No memory state found for user:', telegramId);
        await bot.sendMessage(chatId, 
            '❌ No active memory creation. Please use /create_memory first.'
        );
    }
});

// Handle location messages specifically
bot.on('location', async (msg) => {
    console.log('=== LOCATION EVENT TRIGGERED ===');
    console.log('Location message:', msg);
    
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    
    // Check if user has attendance state
    const attendanceState = attendanceStates.get(telegramId);
    if (attendanceState && attendanceState.step === 'location') {
        console.log('=== PROCESSING LOCATION FOR ATTENDANCE ===');
        try {
            const { data } = attendanceState;
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
                `• Stake: ${event.stake_amount} ${TOKENNAME}`;

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
                    // User is within 200 meters, mark attendance
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
        } catch (error) {
            console.error('Error processing location for attendance:', error);
            await bot.sendMessage(chatId, 
                '❌ Sorry, there was an error processing your location. Please try again.'
            );
            attendanceStates.delete(telegramId);
        }
    } else {
        // Check if user is in event creation flow
        const userState = userStates.get(telegramId);
        if (userState && userState.step === 'location') {
            console.log('=== LOCATION FOR EVENT CREATION - HANDLED BY MAIN MESSAGE HANDLER ===');
            // Let the main message handler process this for event creation
            return;
        }
        
        console.log('No attendance state found for user:', telegramId);
        await bot.sendMessage(chatId, 
            '❌ No active attendance confirmation. Please use /confirm_attendance first.'
        );
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
            `• /confirm_attendance - Confirm your attendance at events\n` +
            `• /end_event - End your created events (creators only)\n` +
            `• /event_summary - View detailed summaries of finalized events\n\n` +
            `**Memories:**\n` +
            `• /create_memory - Create AI-enhanced memory posters with photos for events\n` +
            `• /show_memory - View memories for finalized events\n\n` +
            `**Analytics:**\n` +
            `• /stats - View your personal statistics and achievements\n\n` +
            `**How it works:**\n` +
            `1. Create a wallet with /create_wallet\n` +
            `2. Create events with /create_event or join existing ones with /join_event\n` +
            `3. Use /confirm_attendance to confirm your attendance at events\n` +
            `4. Show up to events to get your stake back plus rewards!\n` +
            `5. Use /event_summary to view detailed attendance reports\n` +
            `6. Check your progress with /stats\n` +
            `7. Create AI-enhanced memory posters with /create_memory\n\n` +
            `**Features:**\n` +
            `• 📍 Location-based attendance verification (within 200m)\n` +
            `• 🎨 AI-enhanced memory poster creation\n` +
            `• 📊 Detailed event summaries and statistics\n` +
            `• 🔗 Blockchain integration for transparency\n` +
            `• 📱 Swipeable UI for easy navigation`;

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

        // Store events in user state for navigation
        userStates.set(telegramId, {
            step: 'browsing_end_events',
            data: {
                createdEvents: createdEvents,
                currentIndex: 0
            }
        });

        // Show first created event
        await showEndEventSlide(chatId, telegramId, 0);

    } catch (error) {
        console.error('Error listing created events:', error);
        await bot.sendMessage(msg.chat.id, 
            '❌ Sorry, there was an error. Please try again later.'
        );
    }
});

// Helper function to show a single end event slide
async function showEndEventSlide(chatId, telegramId, index) {
    try {
        const userState = userStates.get(telegramId);
        if (!userState || userState.step !== 'browsing_end_events') {
            return;
        }

        const { createdEvents } = userState.data;

        if (!createdEvents || createdEvents.length === 0) {
            await bot.sendMessage(chatId, 
                '❌ No active events found.',
                { parse_mode: 'Markdown' }
            );
            return;
        }

        if (index >= createdEvents.length) {
            index = 0;
        }
        if (index < 0) {
            index = createdEvents.length - 1;
        }

        const event = createdEvents[index];
        const eventDate = new Date(event.date).toLocaleString();
        const escapedName = escapeMarkdown(event.name);
        
        let message = `🏁 **Your Created Events**\n\n`;
        message += `**${escapedName}**\n`;
        message += `📅 Date: ${eventDate}\n`;
        message += `💰 Stake: ${event.stake_amount} ${TOKENNAME}\n`;
        message += `Status: ⏳ Active\n`;
        message += `\n📄 ${index + 1} of ${createdEvents.length}`;

        // Create navigation keyboard
        const keyboard = [];
        
        // Navigation row
        const navRow = [];
        if (createdEvents.length > 1) {
            navRow.push({ text: '⬅️ Previous', callback_data: `end_nav_${index - 1}` });
            navRow.push({ text: 'Next ➡️', callback_data: `end_nav_${index + 1}` });
        }
        keyboard.push(navRow);
        
        // Action row
        keyboard.push([
            { text: '🏁 End Event', callback_data: `end_event_${event.id}` }
        ]);
        
        // Close button
        keyboard.push([{ text: '❌ Close', callback_data: 'close_end_events' }]);

        // Update user state
        userState.data.currentIndex = index;
        userStates.set(telegramId, userState);

        await bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: keyboard
            }
        });

    } catch (error) {
        console.error('Error showing end event slide:', error);
        await bot.sendMessage(chatId, 
            '❌ Sorry, there was an error showing the event. Please try again.'
        );
    }
}

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

        // Filter events that haven't been attended yet
        const unattendedEvents = joinedEvents.filter(joined => !joined.attended && !joined.events.finalized);

        if (unattendedEvents.length === 0) {
            await bot.sendMessage(chatId, 
                '✅ You have already attended all your joined events or they have been finalized!'
            );
            return;
        }

        // Store events in user state for navigation
        userStates.set(telegramId, {
            step: 'browsing_attendance_events',
            data: {
                joinedEvents: joinedEvents,
                unattendedEvents: unattendedEvents,
                currentIndex: 0
            }
        });

        // Show first joined event
        await showAttendanceEventSlide(chatId, telegramId, 0);

    } catch (error) {
        console.error('Error listing joined events:', error);
        await bot.sendMessage(msg.chat.id, 
            '❌ Sorry, there was an error. Please try again later.'
        );
    }
});

// Helper function to show a single attendance event slide
async function showAttendanceEventSlide(chatId, telegramId, index) {
    try {
        const userState = userStates.get(telegramId);
        if (!userState || userState.step !== 'browsing_attendance_events') {
            return;
        }

        const { joinedEvents, unattendedEvents } = userState.data;

        if (!joinedEvents || joinedEvents.length === 0) {
            await bot.sendMessage(chatId, 
                '❌ No joined events found.',
                { parse_mode: 'Markdown' }
            );
            return;
        }

        if (index >= joinedEvents.length) {
            index = 0;
        }
        if (index < 0) {
            index = joinedEvents.length - 1;
        }

        const joined = joinedEvents[index];
        const event = joined.events;
        const eventDate = new Date(event.date).toLocaleString();
        const escapedName = escapeMarkdown(event.name);
        
        let message = `📍 **Your Joined Events**\n\n`;
        message += `**${escapedName}**\n`;
        message += `📅 Date: ${eventDate}\n`;
        message += `💰 Stake: ${event.stake_amount} ${TOKENNAME}\n`;
        message += `Status: ${joined.attended ? '✅ Attended' : '⏳ Not Attended'}\n`;
        message += `Event: ${event.finalized ? '🏁 Finalized' : '🔄 Active'}\n`;
        message += `\n📄 ${index + 1} of ${joinedEvents.length}`;

        // Create navigation keyboard
        const keyboard = [];
        
        // Navigation row
        const navRow = [];
        if (joinedEvents.length > 1) {
            navRow.push({ text: '⬅️ Previous', callback_data: `attendance_nav_${index - 1}` });
            navRow.push({ text: 'Next ➡️', callback_data: `attendance_nav_${index + 1}` });
        }
        keyboard.push(navRow);
        
        // Action row - only show confirm attendance for unattended, active events
        if (!joined.attended && !event.finalized) {
            keyboard.push([
                { text: '📍 Confirm Attendance', callback_data: `event_id_${event.id}` }
            ]);
        }
        
        // Close button
        keyboard.push([{ text: '❌ Close', callback_data: 'close_attendance_events' }]);

        // Update user state
        userState.data.currentIndex = index;
        userStates.set(telegramId, userState);

        await bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: keyboard
            }
        });

    } catch (error) {
        console.error('Error showing attendance event slide:', error);
        await bot.sendMessage(chatId, 
            '❌ Sorry, there was an error showing the event. Please try again.'
        );
    }
}

// Handle /event_summary command (show finalized events with attendance details)
bot.onText(/\/event_summary/, async (msg) => {
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

        // Get all finalized events
        const supabase = require('./model');
        const { data: finalizedEvents, error } = await supabase
            .from('events')
            .select('*')
            .eq('finalized', true)
            .order('date', { ascending: false });

        if (error) {
            console.error('Database error:', error);
            await bot.sendMessage(chatId, 
                '❌ Sorry, there was an error retrieving events. Please try again later.'
            );
            return;
        }

        if (!finalizedEvents || finalizedEvents.length === 0) {
            await bot.sendMessage(chatId, 
                '❌ No finalized events found yet. Events need to be finalized by their creators first.'
            );
            return;
        }

        // Show list of finalized events with clickable buttons
        let message = '📊 **Event Summaries (Finalized Events)**\n\n';
        
        finalizedEvents.forEach((event, index) => {
            const eventDate = new Date(event.date).toLocaleString();
            const escapedName = escapeMarkdown(event.name);
            const escapedCreator = escapeWalletAddress(event.creator);
            message += `${index + 1}. **${escapedName}**\n`;
            message += `   📅 ${eventDate}\n`;
            message += `   💰 Stake: ${event.stake_amount} ${TOKENNAME}\n`;
            message += `   👤 Creator: \`${escapedCreator}\`\n\n`;
        });

        message += 'Click on an event to view detailed attendance summary:';

        // Create inline keyboard with event options
        const keyboard = finalizedEvents.map((event, index) => [
            { text: `${index + 1}. ${event.name}`, callback_data: `event_summary_${event.id}` }
        ]);

        await bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: keyboard
            }
        });

    } catch (error) {
        console.error('Error listing finalized events:', error);
        await bot.sendMessage(msg.chat.id, 
            '❌ Sorry, there was an error. Please try again later.'
        );
    }
});

// Handle /stats command (show user statistics)
bot.onText(/\/stats/, async (msg) => {
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

        const supabase = require('./model');

        // Get events created by user
        const { data: createdEvents, error: createdError } = await supabase
            .from('events')
            .select('*')
            .eq('creator', userData.wallet);

        if (createdError) {
            console.error('Database error fetching created events:', createdError);
            throw new Error('Failed to fetch created events');
        }

        // Get events joined by user
        const { data: joinedEvents, error: joinedError } = await supabase
            .from('participants')
            .select(`
                attended,
                events (
                    id,
                    name,
                    date,
                    finalized
                )
            `)
            .eq('wallet', userData.wallet);

        if (joinedError) {
            console.error('Database error fetching joined events:', joinedError);
            throw new Error('Failed to fetch joined events');
        }

        // Calculate statistics
        const totalCreated = createdEvents ? createdEvents.length : 0;
        const totalJoined = joinedEvents ? joinedEvents.length : 0;
        const totalAttended = joinedEvents ? joinedEvents.filter(p => p.attended).length : 0;
        const totalNotAttended = totalJoined - totalAttended;
        const activeCreated = createdEvents ? createdEvents.filter(e => !e.finalized).length : 0;
        const finalizedCreated = totalCreated - activeCreated;
        const activeJoined = joinedEvents ? joinedEvents.filter(p => !p.events.finalized).length : 0;
        const finalizedJoined = totalJoined - activeJoined;

        // Calculate success rates
        const attendanceRate = totalJoined > 0 ? ((totalAttended / totalJoined) * 100).toFixed(1) : 0;
        const completionRate = totalCreated > 0 ? ((finalizedCreated / totalCreated) * 100).toFixed(1) : 0;

        // Generate stats message
        let statsMessage = 
            `📊 **Your Statistics**\n\n` +
            `👤 **User Info:**\n` +
            `• Name: ${userData.telegram_name}\n` +
            `• Wallet: \`${escapeWalletAddress(userData.wallet)}\`\n\n` +
            `🎯 **Event Creation:**\n` +
            `• Total Created: ${totalCreated}\n` +
            `• Active Events: ${activeCreated}\n` +
            `• Finalized Events: ${finalizedCreated}\n` +
            `• Completion Rate: ${completionRate}%\n\n` +
            `🎉 **Event Participation:**\n` +
            `• Total Joined: ${totalJoined}\n` +
            `• Active Participations: ${activeJoined}\n` +
            `• Finalized Participations: ${finalizedJoined}\n` +
            `• Successfully Attended: ${totalAttended}\n` +
            `• Not Attended: ${totalNotAttended}\n` +
            `• Attendance Rate: ${attendanceRate}%\n\n`;

        // Add recent activity if any
        if (totalCreated > 0 || totalJoined > 0) {
            statsMessage += `📅 **Recent Activity:**\n`;
            
            // Show recent created events
            if (createdEvents && createdEvents.length > 0) {
                const recentCreated = createdEvents
                    .sort((a, b) => new Date(b.date) - new Date(a.date))
                    .slice(0, 3);
                
                statsMessage += `**Recent Created Events:**\n`;
                recentCreated.forEach((event, index) => {
                    const eventDate = new Date(event.date).toLocaleString();
                    const status = event.finalized ? '✅ Finalized' : '⏳ Active';
                    statsMessage += `${index + 1}. ${escapeMarkdown(event.name)} - ${status}\n`;
                });
                statsMessage += `\n`;
            }

            // Show recent joined events
            if (joinedEvents && joinedEvents.length > 0) {
                const recentJoined = joinedEvents
                    .sort((a, b) => new Date(b.events.date) - new Date(a.events.date))
                    .slice(0, 3);
                
                statsMessage += `**Recent Joined Events:**\n`;
                recentJoined.forEach((joined, index) => {
                    const event = joined.events;
                    const eventDate = new Date(event.date).toLocaleString();
                    const status = joined.attended ? '✅ Attended' : (event.finalized ? '❌ Missed' : '⏳ Pending');
                    statsMessage += `${index + 1}. ${escapeMarkdown(event.name)} - ${status}\n`;
                });
            }
        } else {
            statsMessage += `📅 **No activity yet.**\n` +
                `Start by creating or joining events!\n\n`;
        }

        // Add achievements section
        statsMessage += `🏆 **Achievements:**\n`;
        if (totalCreated >= 5) {
            statsMessage += `• 🎭 Event Organizer (Created 5+ events)\n`;
        }
        if (totalAttended >= 10) {
            statsMessage += `• 🎯 Reliable Attendee (Attended 10+ events)\n`;
        }
        if (attendanceRate >= 80) {
            statsMessage += `• ⭐ High Attendance Rate (80%+)\n`;
        }
        if (totalCreated === 0 && totalJoined === 0) {
            statsMessage += `• 🆕 New User (Welcome to MeetUp!)\n`;
        }

        await bot.sendMessage(chatId, statsMessage, { parse_mode: 'Markdown' });

    } catch (error) {
        console.error('Error generating user stats:', error);
        await bot.sendMessage(msg.chat.id, 
            `❌ Failed to generate statistics: ${error.message}`
        );
    }
});

// Handle /show_memory command (show memories for finalized events)
bot.onText(/\/show_memory/, async (msg) => {
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

        // Get all finalized events that have memories
        const supabase = require('./model');
        const { data: finalizedEvents, error } = await supabase
            .from('events')
            .select(`
                id,
                name,
                date,
                stake_amount,
                creator,
                finalized,
                memory_posters (
                    id,
                    image_url,
                    blob_id
                )
            `)
            .eq('finalized', true)
            .not('memory_posters', 'is', null)
            .order('date', { ascending: false });

        if (error) {
            console.error('Database error:', error);
            await bot.sendMessage(chatId, 
                '❌ Sorry, there was an error retrieving memories. Please try again later.'
            );
            return;
        }

        if (!finalizedEvents || finalizedEvents.length === 0) {
            await bot.sendMessage(chatId, 
                '❌ No memories found for finalized events. Create some memories first with /create_memory!'
            );
            return;
        }

        // Filter events that actually have memory posters
        const eventsWithMemories = finalizedEvents.filter(event => 
            event.memory_posters && event.memory_posters.length > 0
        );

        if (eventsWithMemories.length === 0) {
            await bot.sendMessage(chatId, 
                '❌ No memories found for finalized events. Create some memories first with /create_memory!'
            );
            return;
        }

        // Show list of finalized events with memories
        let message = '📸 **Event Memories**\n\n';
        message += 'Choose an event to view its memories:\n\n';
        
        eventsWithMemories.forEach((event, index) => {
            const eventDate = new Date(event.date).toLocaleString();
            const escapedName = escapeMarkdown(event.name);
            const memoryCount = event.memory_posters.length;
            message += `${index + 1}. **${escapedName}**\n`;
            message += `   📅 ${eventDate}\n`;
            message += `   💰 Stake: ${event.stake_amount} ${TOKENNAME}\n`;
            message += `   📸 Memories: ${memoryCount}\n\n`;
        });

        // Create inline keyboard with event options
        const keyboard = eventsWithMemories.map((event, index) => [
            { text: `${index + 1}. ${event.name}`, callback_data: `show_memory_${event.id}` }
        ]);

        await bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: keyboard
            }
        });

    } catch (error) {
        console.error('Error listing events for memory viewing:', error);
        await bot.sendMessage(msg.chat.id, 
            '❌ Sorry, there was an error. Please try again later.'
        );
    }
});

// Handle /create_memory command (create memories for events)
bot.onText(/\/create_memory/, async (msg) => {
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

        // Get all events (both active and finalized)
        const supabase = require('./model');
        const { data: allEvents, error } = await supabase
            .from('events')
            .select('*')
            .order('date', { ascending: false });

        if (error) {
            console.error('Database error:', error);
            await bot.sendMessage(chatId, 
                '❌ Sorry, there was an error retrieving events. Please try again later.'
            );
            return;
        }

        if (!allEvents || allEvents.length === 0) {
            await bot.sendMessage(chatId, 
                '❌ No events found. Create some events first with /create_event!'
            );
            return;
        }

        // Show list of events with clickable buttons
        let message = '📸 **Create Event Memory**\n\n';
        message += 'Choose an event to create a memory for:\n\n';
        
        allEvents.forEach((event, index) => {
            const eventDate = new Date(event.date).toLocaleString();
            const escapedName = escapeMarkdown(event.name);
            const status = event.finalized ? '✅ Finalized' : '⏳ Active';
            message += `${index + 1}. **${escapedName}**\n`;
            message += `   📅 ${eventDate}\n`;
            message += `   💰 Stake: ${event.stake_amount} ${TOKENNAME}\n`;
            message += `   ${status}\n\n`;
        });

        // Create inline keyboard with event options
        const keyboard = allEvents.map((event, index) => [
            { text: `${index + 1}. ${event.name}`, callback_data: `create_memory_${event.id}` }
        ]);

        await bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: keyboard
            }
        });

    } catch (error) {
        console.error('Error listing events for memory creation:', error);
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
            return;
        }

        if (data === 'close_events') {
            // Clear user state
            userStates.delete(telegramId);
            await bot.sendMessage(chatId, '✅ Event browser closed.');
            return;
        }

        // Handle event navigation
        if (data.startsWith('event_nav_')) {
            const parts = data.split('_');
            const type = parts[2];
            const index = parseInt(parts[3]);
            
            await showEventSlide(chatId, telegramId, index, type);
            return;
        }

        // Handle event type switching
        if (data.startsWith('event_type_')) {
            const parts = data.split('_');
            const type = parts[2];
            const index = parseInt(parts[3]);
            
            await showEventSlide(chatId, telegramId, index, type);
            return;
        }

        // Handle join event navigation
        if (data.startsWith('join_nav_')) {
            const index = parseInt(data.replace('join_nav_', ''));
            
            await showJoinEventSlide(chatId, telegramId, index);
            return;
        }

        // Handle end event navigation
        if (data.startsWith('end_nav_')) {
            const index = parseInt(data.replace('end_nav_', ''));
            
            await showEndEventSlide(chatId, telegramId, index);
            return;
        }

        if (data === 'close_end_events') {
            // Clear user state
            userStates.delete(telegramId);
            await bot.sendMessage(chatId, '✅ Event browser closed.');
            return;
        }

        // Handle attendance event navigation
        if (data.startsWith('attendance_nav_')) {
            const index = parseInt(data.replace('attendance_nav_', ''));
            
            await showAttendanceEventSlide(chatId, telegramId, index);
            return;
        }

        if (data === 'close_attendance_events') {
            // Clear user state
            userStates.delete(telegramId);
            await bot.sendMessage(chatId, '✅ Attendance browser closed.');
            return;
        }

        if (data.startsWith('event_id_')) {
            const eventId = data.replace('event_id_', '');
            console.log('=== EVENT_ID CALLBACK TRIGGERED ===');
            console.log('Event ID selected for attendance:', eventId, 'User:', telegramId);
            console.log('User name:', userName);
            
            // Get event details
            const event = await getEventById(eventId);
            if (!event) {
                console.log('Event not found:', eventId);
                await bot.sendMessage(chatId, '❌ Event not found. Please try again.');
                return;
            }

            console.log('Event found:', event.name, 'Setting attendance state for user:', telegramId);
            console.log('Event details:', {
                id: event.id,
                name: event.name,
                date: event.date,
                location_lat: event.location_lat,
                location_lng: event.location_lng
            });
            
            // Store event data for location step
            attendanceStates.set(telegramId, {
                step: 'location',
                data: { selectedEvent: event }
            });
            
            console.log('Attendance state set:', attendanceStates.get(telegramId));
            console.log('Current attendance states:', Array.from(attendanceStates.entries()));

            const eventDate = new Date(event.date).toLocaleString();
            const message = 
                `📅 **Event Selected:** ${escapeMarkdown(event.name)}\n\n` +
                `📅 Date: ${eventDate}\n` +
                `💰 Stake: ${event.stake_amount} ${TOKENNAME}\n` +
                `📍 Event Location: ${event.location_lat && event.location_lng ? 'Location shared via Telegram' : 'Manual location'}\n\n` +
                `📍 **Share Your Current Location**\n` +
                `Please share your current location so I can verify you're at the event.\n\n` +
                `**How to share location:**\n` +
                `• Tap the 📎 attachment button\n` +
                `• Select "Location"\n` +
                `• Choose "Send your current location"`;

            await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
            console.log('=== EVENT_ID CALLBACK COMPLETED ===');
            return;
        }

        if (data.startsWith('event_summary_')) {
            const eventId = parseInt(data.replace('event_summary_', ''));
            
            try {
                // Get event details
                const event = await getEventById(eventId);
                if (!event) {
                    await bot.sendMessage(chatId, '❌ Event not found. Please try again.');
                    return;
                }

                // Get all participants for this event
                const supabase = require('./model');
                const { data: participants, error: participantsError } = await supabase
                    .from('participants')
                    .select(`
                        wallet,
                        attended,
                        checkin_time,
                        location_lat,
                        location_lng,
                        users (
                            telegram_name
                        )
                    `)
                    .eq('event_id', eventId);

                if (participantsError) {
                    console.error('Error fetching participants:', participantsError);
                    throw new Error('Failed to fetch event participants');
                }

                // Generate detailed event summary
                const eventDate = new Date(event.date).toLocaleString();
                const totalParticipants = participants.length;
                const attendedParticipants = participants.filter(p => p.attended).length;
                const notAttendedParticipants = totalParticipants - attendedParticipants;

                let summaryMessage = 
                    `📊 **Event Summary Report**\n\n` +
                    `📅 **Event Details:**\n` +
                    `• Name: ${escapeMarkdown(event.name)}\n` +
                    `• Date: ${eventDate}\n` +
                    `• Stake: ${event.stake_amount} ${TOKENNAME}\n` +
                    `• Creator: \`${escapeWalletAddress(event.creator)}\`\n` +
                    `• Chain: ${event.chain}\n`;

                // Add location if available
                if (event.location_lat && event.location_lng) {
                    summaryMessage += `• Location: \`${event.location_lat}, ${event.location_lng}\`\n`;
                } else {
                    summaryMessage += `• Location: Manual location (no coordinates)\n`;
                }

                summaryMessage += `\n📊 **Attendance Statistics:**\n` +
                    `• Total Participants: ${totalParticipants}\n` +
                    `• Attended: ${attendedParticipants}\n` +
                    `• Not Attended: ${notAttendedParticipants}\n` +
                    `• Attendance Rate: ${totalParticipants > 0 ? ((attendedParticipants / totalParticipants) * 100).toFixed(1) : 0}%\n\n`;

                if (participants.length > 0) {
                    summaryMessage += `👥 **Detailed Participant List:**\n\n`;
                    
                    // Show attended participants first
                    const attended = participants.filter(p => p.attended);
                    const notAttended = participants.filter(p => !p.attended);
                    
                    if (attended.length > 0) {
                        summaryMessage += `✅ **Attended (${attended.length}):**\n`;
                        attended.forEach((participant, index) => {
                            const userName = participant.users?.telegram_name || 'Unknown User';
                            
                            summaryMessage += `${index + 1}. **${userName}**\n`;
                            summaryMessage += `   🔑 Wallet: \`${escapeWalletAddress(participant.wallet)}\`\n\n`;
                        });
                    }
                    
                    if (notAttended.length > 0) {
                        summaryMessage += `❌ **Not Attended (${notAttended.length}):**\n`;
                        notAttended.forEach((participant, index) => {
                            const userName = participant.users?.telegram_name || 'Unknown User';
                            summaryMessage += `${index + 1}. **${userName}**\n`;
                            summaryMessage += `   🔑 Wallet: \`${escapeWalletAddress(participant.wallet)}\`\n\n`;
                        });
                    }
                } else {
                    summaryMessage += `👥 **No participants found for this event.**\n`;
                }

                await bot.sendMessage(chatId, summaryMessage, { parse_mode: 'Markdown' });

            } catch (error) {
                console.error('Error generating event summary:', error);
                await bot.sendMessage(chatId, 
                    `❌ Failed to generate event summary: ${error.message}`
                );
            }
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
                    `• Stake: ${event.stake_amount} ${TOKENNAME}\n` +
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
                return;
            }

            const eventDate = new Date(event.date).toLocaleString();

                                    const message = 
                            `📅 **Event Selected:** ${event.name}\n\n` +
                            `📅 Date: ${eventDate}\n` +
                            `💰 Stake Amount: ${event.stake_amount} ${TOKENNAME}\n` +
                            `👤 Creator: \`${escapeWalletAddress(event.creator)}\`\n\n` +
                            `⚠️ **Important:** Joining this event will stake ${event.stake_amount} ${TOKENNAME} from your wallet.\n\n` +
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



        if (data.startsWith('show_memory_')) {
            const eventId = parseInt(data.replace('show_memory_', ''));
            
            try {
                // Get event details and its memories
                const supabase = require('./model');
                const { data: eventWithMemories, error } = await supabase
                    .from('events')
                    .select(`
                        id,
                        name,
                        date,
                        stake_amount,
                        creator,
                        finalized,
                        memory_posters (
                            id,
                            image_url,
                            blob_id,
                            created_at
                        )
                    `)
                    .eq('id', eventId)
                    .eq('finalized', true)
                    .single();

                if (error || !eventWithMemories) {
                    await bot.sendMessage(chatId, '❌ Event not found or not finalized. Please try again.');
                    return;
                }

                if (!eventWithMemories.memory_posters || eventWithMemories.memory_posters.length === 0) {
                    await bot.sendMessage(chatId, '❌ No memories found for this event.');
                    return;
                }

                const event = eventWithMemories;
                const eventDate = new Date(event.date).toLocaleString();
                const escapedName = escapeMarkdown(event.name);
                const escapedCreator = escapeWalletAddress(event.creator);

                // Send event info first
                const eventInfo = 
                    `📸 **Memories for:** ${escapedName}\n\n` +
                    `📅 Date: ${eventDate}\n` +
                    `💰 Stake: ${event.stake_amount} ${TOKENNAME}\n` +
                    `👤 Creator: \`${escapedCreator}\`\n` +
                    `📸 Total Memories: ${event.memory_posters.length}\n\n` +
                    `🔄 Loading memories...`;

                await bot.sendMessage(chatId, eventInfo, { parse_mode: 'Markdown' });

                // Prepare media group for all memories using temporary files
                const mediaGroup = [];
                const tempFiles = [];
                const { retrieveFileFromWalrus } = require('./walrus');
                
                for (let i = 0; i < event.memory_posters.length; i++) {
                    const memory = event.memory_posters[i];
                    const memoryDate = new Date(memory.created_at).toLocaleString();
                    
                    try {
                        // Try to get image buffer from Walrus
                        const imageBuffer = await retrieveFileFromWalrus(memory.blob_id);
                        
                        // Create temporary file for media group
                        const tempFilePath = path.join(__dirname, `temp_memory_${memory.blob_id}.jpg`);
                        fs.writeFileSync(tempFilePath, imageBuffer);
                        tempFiles.push(tempFilePath);
                        
                        // Create media object for node-telegram-bot-api
                        const mediaObject = {
                            type: 'photo',
                            media: fs.createReadStream(tempFilePath),
                            caption: i === 0 ? 
                                `📸 **Memories for:** ${escapedName}\n\n` +
                                `📅 Date: ${eventDate}\n` +
                                `💰 Stake: ${event.stake_amount} ${TOKENNAME}\n` +
                                `👤 Creator: \`${escapedCreator}\`\n` +
                                `📸 Total Memories: ${event.memory_posters.length}\n\n` +
                                `📸 **Memory ${i + 1}/${event.memory_posters.length}**\n` +
                                `📅 Created: ${memoryDate}\n` +
                                `🔗 Walrus ID: \`${memory.blob_id}\`` : 
                                `📸 **Memory ${i + 1}/${event.memory_posters.length}**\n` +
                                `📅 Created: ${memoryDate}\n` +
                                `🔗 Walrus ID: \`${memory.blob_id}\``,
                            parse_mode: 'Markdown'
                        };
                        
                        mediaGroup.push(mediaObject);
                    } catch (error) {
                        console.error(`Failed to retrieve memory ${i + 1}:`, error.message);
                        
                        // Skip failed memories instead of adding error placeholders
                        continue;
                    }
                }

                // Send all memories as a media group (slider)
                if (mediaGroup.length > 0) {
                    try {
                        console.log(`Sending media group with ${mediaGroup.length} photos`);
                        await bot.sendMediaGroup(chatId, mediaGroup);
                        
                        // Clean up temporary files after successful send
                        tempFiles.forEach(tempFile => {
                            try {
                                fs.unlinkSync(tempFile);
                            } catch (cleanupError) {
                                console.error('Error cleaning up temp file:', cleanupError.message);
                            }
                        });
                    } catch (mediaGroupError) {
                        console.error('Failed to send media group:', mediaGroupError.message);
                        console.error('Media group error details:', JSON.stringify(mediaGroupError, null, 2));
                        
                        // Clean up temporary files
                        tempFiles.forEach(tempFile => {
                            try {
                                fs.unlinkSync(tempFile);
                            } catch (cleanupError) {
                                console.error('Error cleaning up temp file:', cleanupError.message);
                            }
                        });
                        
                        // Fallback: send individual photos if media group fails
                        await bot.sendMessage(chatId, '⚠️ Sending memories individually due to media group error...');
                        
                        for (let i = 0; i < event.memory_posters.length; i++) {
                            const memory = event.memory_posters[i];
                            const memoryDate = new Date(memory.created_at).toLocaleString();
                            
                            try {
                                const imageBuffer = await retrieveFileFromWalrus(memory.blob_id);
                                const caption = 
                                    `📸 **Memory ${i + 1}/${event.memory_posters.length}**\n\n` +
                                    `📅 Event: ${escapedName}\n` +
                                    `📅 Created: ${memoryDate}\n` +
                                    `🔗 Walrus ID: \`${memory.blob_id}\``;
                                
                                await bot.sendPhoto(chatId, imageBuffer, {
                                    caption: caption,
                                    parse_mode: 'Markdown'
                                });
                                
                                // Small delay between individual photos
                                if (i < event.memory_posters.length - 1) {
                                    await new Promise(resolve => setTimeout(resolve, 1000));
                                }
                            } catch (individualError) {
                                console.error(`Failed to send individual photo ${i + 1}:`, individualError.message);
                                await bot.sendMessage(chatId, 
                                    `❌ Failed to send memory ${i + 1}: ${individualError.message}`
                                );
                            }
                        }
                    }
                } else {
                    await bot.sendMessage(chatId, '❌ No memories could be loaded. Please try again.');
                }

            } catch (error) {
                console.error('Error showing memories:', error);
                await bot.sendMessage(chatId, 
                    `❌ Failed to show memories: ${error.message}`
                );
            }
            return;
        }

        if (data.startsWith('create_memory_')) {
            const eventId = parseInt(data.replace('create_memory_', ''));
            
            try {
                // Get event details
                const event = await getEventById(eventId);
                if (!event) {
                    await bot.sendMessage(chatId, '❌ Event not found. Please try again.');
                    return;
                }

                // Store event data for photo upload step
                memoryStates.set(telegramId, {
                    step: 'photo_upload',
                    data: { selectedEvent: event }
                });

                const eventDate = new Date(event.date).toLocaleString();
                const message = 
                    `📸 **Memory Creation for:** ${escapeMarkdown(event.name)}\n\n` +
                    `📅 Date: ${eventDate}\n` +
                    `💰 Stake: ${event.stake_amount} ${TOKENNAME}\n` +
                    `👤 Creator: \`${escapeWalletAddress(event.creator)}\`\n\n` +
                    `📷 **Upload Iconic Group Photo**\n` +
                    `Please send a photo that captures the memory of this event.\n\n` +
                    `**How to upload:**\n` +
                    `• Tap the 📎 attachment button\n` +
                    `• Select "Photo"\n` +
                    `• Choose or take a photo\n` +
                    `• Add a caption if you want`;

                await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });

            } catch (error) {
                console.error('Error setting up memory creation:', error);
                await bot.sendMessage(chatId, 
                    `❌ Failed to set up memory creation: ${error.message}`
                );
            }
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
                    `💰 **Stake Paid:** ${result.stakeAmount} ${TOKENNAME}\n` +
                    `🔗 **Transaction:** \`${result.txHash}\`\n\n` +
                    `✅ You are now a participant! Show up to get your stake back plus rewards!`;

                await bot.sendMessage(chatId, successMessage, { parse_mode: 'Markdown' });

            } catch (error) {
                console.error('Error joining event:', error);
                await bot.sendMessage(chatId, 
                    `❌ Failed to join event: ${error.message}`
                );
            }

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
                attendanceStates.delete(telegramId);
                memoryStates.delete(telegramId);
            }
        } catch (cleanupError) {
            console.error('Error during cleanup:', cleanupError);
        }
    }
});
