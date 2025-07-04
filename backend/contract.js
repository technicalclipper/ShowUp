const { ethers } = require('ethers');
const config = require('./config');
const supabase = require('./model');

// Create a new wallet for a user
async function createWallet(telegramId, telegramName) {
    try {
        // Generate a new wallet
        const wallet = ethers.Wallet.createRandom();
        
        // Prepare user data for database
        const userData = {
            wallet: wallet.address,
            telegram_id: telegramId.toString(),
            telegram_name: telegramName,
            private_key: wallet.privateKey, // ⚠️ Store carefully (plaintext only for hackathon)
            created_at: new Date().toISOString(),
            last_active: new Date().toISOString()
        };

        // Insert user into database
        const { data, error } = await supabase
            .from('users')
            .insert([userData])
            .select();

        if (error) {
            console.error('Database error:', error);
            throw new Error('Failed to save user to database');
        }

        console.log('Wallet created and user saved:', wallet.address);
        return {
            address: wallet.address,
            privateKey: wallet.privateKey
        };
    } catch (error) {
        console.error('Error creating wallet:', error);
        throw error;
    }
}

// Check if user already has a wallet
async function getUserWallet(telegramId) {
    try {
        const { data, error } = await supabase
            .from('users')
            .select('wallet, telegram_name')
            .eq('telegram_id', telegramId.toString())
            .single();

        if (error && error.code !== 'PGRST116') { // PGRST116 is "not found"
            console.error('Database error:', error);
            throw error;
        }

        return data;
    } catch (error) {
        console.error('Error getting user wallet:', error);
        throw error;
    }
}

// Get wallet balance
async function getWalletBalance(walletAddress) {
    try {
        const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || 'https://sepolia.base.org');
        const balance = await provider.getBalance(walletAddress);
        const balanceInEth = ethers.formatEther(balance);
        return balanceInEth;
    } catch (error) {
        console.error('Error getting wallet balance:', error);
        throw error;
    }
}

// Create event on blockchain and database
async function createEvent(telegramId, eventName, eventDate, stakeAmount, locationLat, locationLng) {
    try {
        // Check if Supabase is initialized
        if (!supabase) {
            throw new Error('Supabase client not initialized');
        }

        // Get user wallet for database record
        const userData = await getUserWallet(telegramId);
        if (!userData) {
            throw new Error('User wallet not found');
        }

        // Convert date to timestamp
        const dateTimestamp = Math.floor(new Date(eventDate).getTime() / 1000);
        
        // Convert stake amount to Wei
        const stakeAmountWei = ethers.parseEther(stakeAmount.toString());

        // Use bot's wallet from config.js
        const config = require('./config');
        const botWallet = config.wallet;
        const botContract = config.contract;

        if (!botWallet || !botContract) {
            throw new Error('Bot wallet or contract not properly configured');
        }

        // Call contract function using bot's wallet
        const tx = await botContract.createEvent(eventName, dateTimestamp, stakeAmountWei);
        const receipt = await tx.wait();
        
        // Get event ID from transaction receipt
        const eventId = receipt.logs[0].args.eventId || receipt.logs[0].args[0];

        // Save event to database with user as creator
        const eventData = {
            id: parseInt(eventId.toString()), // Convert to integer for database
            name: eventName,
            date: new Date(eventDate).toISOString(),
            stake_amount: parseFloat(stakeAmount),
            creator: userData.wallet, // Still store user as creator in database
            finalized: false,
            chain: 'base-sepolia', // Add chain field as required by database
            location_lat: locationLat,
            location_lng: locationLng
        };

        console.log('Attempting to save event to database:', eventData);
        
        const { data, error } = await supabase
            .from('events')
            .insert([eventData])
            .select();

        if (error) {
            console.error('Database error:', error);
            console.error('Event data that failed:', eventData);
            throw new Error(`Failed to save event to database: ${error.message}`);
        }

        console.log('Event saved to database successfully:', data[0]);

        return {
            eventId: eventId.toString(),
            txHash: receipt.hash,
            eventData: data[0],
            botWallet: botWallet.address // Include bot wallet address for reference
        };

    } catch (error) {
        console.error('Error creating event:', error);
        throw error;
    }
}

// Get all events from database
async function getEvents() {
    try {
        const { data, error } = await supabase
            .from('events')
            .select('*')
            .order('date', { ascending: true });

        if (error) {
            console.error('Database error:', error);
            throw error;
        }

        return data;
    } catch (error) {
        console.error('Error getting events:', error);
        throw error;
    }
}

module.exports = {
    createWallet,
    getUserWallet,
    getWalletBalance,
    createEvent,
    getEvents
};