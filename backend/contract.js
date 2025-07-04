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

