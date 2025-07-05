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
            chain: process.env.CHAINNAME || 'base-sepolia', // Use environment variable for chain name
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

// Get events joined by a specific user
async function getJoinedEvents(telegramId) {
    try {
        const { data, error } = await supabase
            .from('participants')
            .select(`
                event_id,
                has_staked,
                attended,
                events (
                    id,
                    name,
                    date,
                    stake_amount,
                    creator,
                    finalized,
                    chain,
                    location_lat,
                    location_lng
                )
            `)
            .eq('telegram_id', telegramId.toString())
            .order('event_id', { ascending: true });

        if (error) {
            console.error('Database error:', error);
            throw error;
        }

        return data;
    } catch (error) {
        console.error('Error getting joined events:', error);
        throw error;
    }
}

// Get event by name
async function getEventByName(eventName) {
    try {
        const { data, error } = await supabase
            .from('events')
            .select('*')
            .ilike('name', `%${eventName}%`)
            .eq('finalized', false)
            .order('date', { ascending: true });

        if (error) {
            console.error('Database error:', error);
            throw error;
        }

        return data;
    } catch (error) {
        console.error('Error getting event by name:', error);
        throw error;
    }
}

// Get event by ID
async function getEventById(eventId) {
    try {
        const { data, error } = await supabase
            .from('events')
            .select('*')
            .eq('id', eventId)
            .single();

        if (error) {
            console.error('Database error:', error);
            throw error;
        }

        return data;
    } catch (error) {
        console.error('Error getting event by ID:', error);
        throw error;
    }
}

// Join event on blockchain and database
async function joinEvent(telegramId, eventId) {
    try {
        // Check if Supabase is initialized
        if (!supabase) {
            throw new Error('Supabase client not initialized');
        }

        // Get user wallet
        const userData = await getUserWallet(telegramId);
        if (!userData) {
            throw new Error('User wallet not found');
        }

        // Get event details
        const eventData = await getEventById(eventId);
        if (!eventData) {
            throw new Error('Event not found');
        }

        if (eventData.finalized) {
            throw new Error('Event is already finalized');
        }

        // Check if user already joined
        const { data: existingParticipant } = await supabase
            .from('participants')
            .select('*')
            .eq('event_id', eventId)
            .eq('wallet', userData.wallet)
            .single();

        if (existingParticipant) {
            throw new Error('You have already joined this event');
        }

        // Convert stake amount to Wei
        const stakeAmountWei = ethers.parseEther(eventData.stake_amount.toString());

        // Get user's private key from database
        const { data: userPrivateKey } = await supabase
            .from('users')
            .select('private_key')
            .eq('telegram_id', telegramId.toString())
            .single();

        if (!userPrivateKey) {
            throw new Error('User private key not found');
        }

        // Create wallet instance with user's private key
        const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
        const userWallet = new ethers.Wallet(userPrivateKey.private_key, provider);
        
        // Create contract instance with user's wallet
        const contract = new ethers.Contract(
            process.env.CONTRACT_ADDRESS,
            require('./config').CONTRACT_ABI,
            userWallet
        );

        // Call contract function to join event
        const tx = await contract.joinEvent(eventId, { value: stakeAmountWei });
        const receipt = await tx.wait();

        // Save participant to database
        const participantData = {
            event_id: eventId,
            wallet: userData.wallet,
            telegram_id: telegramId.toString(),
            has_staked: true,
            attended: false
        };

        const { data, error } = await supabase
            .from('participants')
            .insert([participantData])
            .select();

        if (error) {
            console.error('Database error:', error);
            throw new Error('Failed to save participant to database');
        }

        return {
            eventId: eventId.toString(),
            txHash: receipt.hash,
            participantData: data[0],
            eventName: eventData.name,
            stakeAmount: eventData.stake_amount
        };

    } catch (error) {
        console.error('Error joining event:', error);
        throw error;
    }
}

// Mint NFT for memory
async function mintMemoryNFT(telegramId, eventId, imageUrl) {
    try {
        // Check if Supabase is initialized
        if (!supabase) {
            throw new Error('Supabase client not initialized');
        }

        // Get user wallet
        const userData = await getUserWallet(telegramId);
        if (!userData) {
            throw new Error('User wallet not found');
        }

        // Get event details
        const eventData = await getEventById(eventId);
        if (!eventData) {
            throw new Error('Event not found');
        }

        if (!eventData.finalized) {
            throw new Error('Event must be finalized to mint NFT');
        }

        // Check if user is a participant
        const { data: participant } = await supabase
            .from('participants')
            .select('*')
            .eq('event_id', eventId)
            .eq('wallet', userData.wallet)
            .single();

        if (!participant) {
            throw new Error('You must be an event participant to mint NFT');
        }

        // Get user's private key from database
        const { data: userPrivateKey } = await supabase
            .from('users')
            .select('private_key')
            .eq('telegram_id', telegramId.toString())
            .single();

        if (!userPrivateKey) {
            throw new Error('User private key not found');
        }

        // Create wallet instance with user's private key
        const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
        const userWallet = new ethers.Wallet(userPrivateKey.private_key, provider);
        
        // Create contract instance with user's wallet
        const contract = new ethers.Contract(
            process.env.CONTRACT_ADDRESS,
            require('./config').CONTRACT_ABI,
            userWallet
        );

        // Call contract function to mint NFT using user's wallet
        const tx = await contract.mintMemoryNFT(eventId, imageUrl);
        const receipt = await tx.wait();
        
        // Get token ID from transaction receipt
        const tokenId = receipt.logs[0].args.tokenId || receipt.logs[0].args[0];

        return {
            tokenId: tokenId.toString(),
            txHash: receipt.hash,
            eventId: eventId.toString(),
            imageUrl: imageUrl,
            eventName: eventData.name,
            userWallet: userWallet.address
        };

    } catch (error) {
        console.error('Error minting NFT:', error);
        throw error;
    }
}

module.exports = {
    createWallet,
    getUserWallet,
    getWalletBalance,
    createEvent,
    getEvents,
    getJoinedEvents,
    getEventByName,
    getEventById,
    joinEvent,
    mintMemoryNFT
};