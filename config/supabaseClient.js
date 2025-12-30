const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

// This creates the connection to your specific database
const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;