// middleware/authMiddleware.js
const jwt = require('jsonwebtoken');
const supabase = require('../config/supabaseClient');

// Protect routes for all logged-in users
exports.protect = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: "No token provided" });
  }
  try {
    // This asks Supabase: "Is this token valid and which user does it belong to?"
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) throw new Error("Invalid token");

    req.user = user; // Add the user object to the request
    next();
  } catch (error) {
    res.status(401).json({ error: "Not authorized" });
  }
};

// Restrict routes to admin users only
exports.adminOnly = async (req, res, next) => {
  try {
    // Query the profiles table we created to check the role
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', req.user.id) // req.user.id comes from the protect middleware
      .single();

    if (error || !profile) {
      return res.status(403).json({ error: "Access denied. Profile not found." });
    }

    if (profile.role === 'admin') {
      next(); // User is admin, proceed
    } else {
      res.status(403).json({ error: "Access denied. Admins only." });
    }
  } catch (err) {
    res.status(500).json({ error: "Server error checking admin status" });
  }
};


