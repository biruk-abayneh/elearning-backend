// controllers/contentController.js
const supabase = require('../config/supabaseClient');

// 1. Fetch all available subjects
exports.getSubjects = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('subjects')
      .select('*'); // Gets everything from the subjects table [cite: 149]

    if (error) throw error;
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: "Could not fetch subjects" });
  }
};

// 2. Fetch chapters for a specific subject
exports.getChapters = async (req, res) => {
  const { subjectId } = req.query; // The app sends the ID of the chosen subject

  try {
    const { data, error } = await supabase
      .from('chapters')
      .select('*')
      .eq('subject_id', subjectId); // Filter: only give chapters for this subject [cite: 150]

    if (error) throw error;
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: "Could not fetch chapters" });
  }
};

// 3. Fetch ONLY active questions for a chapter
exports.getQuestions = async (req, res) => {
  const { chapterId } = req.query;

  try {
    const { data, error } = await supabase
      .from('questions')
      .select('id, question_text, options, chapter_id') // We DON'T send the answer yet! [cite: 103, 151]
      .eq('chapter_id', chapterId)
      .eq('is_active', true); // Requirement: Only show the "live" version [cite: 89, 91]

    if (error) throw error;
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: "Could not fetch questions" });
  }
};

exports.getExplanations = async (req, res) => {
  const { chapterId } = req.params;

  try {
    // Query the database for explanations
    const { data, error } = await supabase
      .from('questions')
      .select('id, explanation')
      .eq('chapter_id', chapterId);

    if (error) throw error;

    // Convert the array to a key-value object: { "q_id": "explanation text" }
    const explanationMap = data.reduce((acc, item) => {
      acc[item.id] = item.explanation;
      return acc;
    }, {});

    res.status(200).json(explanationMap);
  } catch (error) {
    console.error("Explanations Fetch Error:", error);
    res.status(500).json({ error: "Failed to fetch explanations" });
  }
};
exports.createQuestion = async (req, res) => {
  try {
    const { data, error } = await supabase.from('questions').insert([req.body]);
    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Save the final result when quiz ends
exports.saveAttempt = async (req, res) => {
  const { chapterId, score, totalQuestions } = req.body;
  const percentage = (score / totalQuestions) * 100;

  try {
    const { data, error } = await supabase
      .from('quiz_attempts')
      .insert([{
        user_id: req.user.id,
        chapter_id: chapterId,
        score,
        total_questions: totalQuestions,
        percentage
      }]);

    if (error) throw error;
    res.status(201).json({ message: "Attempt saved" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get Dashboard Data + Rank
exports.getUserDashboard = async (req, res) => {
  try {
    // 1. Get user's recent attempts
    const { data: attempts } = await supabase
      .from('quiz_attempts')
      .select(`
        score, total_questions, percentage, created_at,
        chapters (name, subject_id, subjects (name))
      `)
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    // 2. Calculate Rank (Leaderboard Logic)
    // We compare total points (sum of scores) across all users
    const { data: leaderboard } = await supabase
      .rpc('get_user_rankings'); // We will create this SQL function next

    const myRank = leaderboard.find(u => u.user_id === req.user.id);

    res.json({ attempts, rank: myRank });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};