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