const supabase = require('../config/supabaseClient');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

exports.register = async (req, res) => {
  const { email, password, full_name } = req.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  
  const { data, error } = await supabase
    .from('users')
    .insert([{ email, password_hash: hashedPassword, full_name }])
    .select();

  if (error) return res.status(400).json(error);
  res.status(201).json(data[0]);
};