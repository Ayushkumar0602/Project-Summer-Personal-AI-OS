const { createClient } = require('@supabase/supabase-js');
const { createLogger } = require('../core/utils/logger');
const log = createLogger('SupabaseClient');

// Load environment variables if they exist
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

let supabase = null;

if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
    try {
        supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
            auth: {
                persistSession: false,
                autoRefreshToken: false,
            }
        });
        log.info('Supabase client initialized successfully.');
    } catch (e) {
        log.error('Failed to initialize Supabase client:', e.message);
    }
} else {
    log.warn('Supabase credentials missing. Cloud database features will be disabled. Falling back to local storage.');
}

module.exports = { supabase };
