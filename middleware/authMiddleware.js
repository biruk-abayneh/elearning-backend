// middleware/authMiddleware.js
const jwt = require('jsonwebtoken');
const supabase = require('../config/supabaseClient');

// Protect routes for all logged-in users
exports.protect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1];

    if (!token) {
      console.log("Middleware: No token found in headers");
      return res.status(401).json({ error: "No token provided" });
    }

    // Validate token with Supabase
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) {
      console.error("Middleware: Supabase Auth Error:", error?.message);
      return res.status(401).json({ error: "Invalid token" });
    }

    // SUCCESS: Attach the user to the request
    req.user = data.user;

    next(); // Move to the controller
  } catch (error) {
    console.error("Middleware: Catch Error:", error.message);
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
      console.log("Supabase error:", error);
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


