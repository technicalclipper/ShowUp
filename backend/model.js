require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

let supabase;

try {
    if (!supabaseUrl || !supabaseKey) {
        throw new Error('Missing Supabase URL or API key');
    }
    supabase = createClient(supabaseUrl, supabaseKey);
    console.log('Supabase client initialized successfully');
} catch (error) {
    console.error('Error initializing Supabase client:', error.message);
    supabase = null;
}

module.exports = supabase;