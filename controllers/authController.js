const supabase = require('../config/supabaseClient');

exports.getProfile = async (req, res) => {
  try {
    // req.user is already set by your protect middleware
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', req.user.id)
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};