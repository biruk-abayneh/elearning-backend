// controllers/adminController.js

const supabase = require('../config/supabaseClient');

exports.upsertQuestion = async (req, res) => {
  const { questionId, chapterId, questionText, options, correctAnswer, explanation } = req.body;

  try {
    // 1. If we are "editing" (questionId exists), we Soft Delete the old one
    if (questionId) {
      await supabase
        .from('questions')
        .update({ is_active: false }) // Hide it from future users [cite: 91]
        .eq('id', questionId);
    }

    // 2. Create the new (or updated) version of the question
    // This allows up to 5 options (A, B, C, D, E) 
    const { data, error } = await supabase
      .from('questions')
      .insert([{
        chapter_id: chapterId,
        question_text: questionText,
        options: options,        // Array of strings
        correct_answer: correctAnswer,
        explanation: explanation, // Static admin-authored text [cite: 102, 104]
        is_active: true          // This one is now the "live" version
      }]);

    if (error) throw error;

    res.status(201).json({ message: "Question saved successfully", data });
  } catch (err) {
    // Consistent error format without raw stack traces [cite: 155, 156]
    res.status(500).json({ error: "Failed to save question" });
  }
};

// backend/controllers/adminController.js

exports.createSubject = async (req, res) => {
  try {
    // 1. Remove the 'const headers = ...' line entirely
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Subject name is required" });
    }

    const { data, error } = await supabase
      .from('subjects')
      .insert([{ name }])
      .select();

    if (error) throw error;

    // 2. Send the response back
    res.status(201).json(data[0]);
  } catch (error) {
    console.error("Admin Controller Error:", error.message);
    res.status(500).json({ error: error.message });
  }
};

exports.createChapter = async (req, res) => {
  const { subject_id, name } = req.body;
  const { data, error } = await supabase
    .from('chapters')
    .insert([{ subject_id, name }])
    .select();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data[0]);
};

exports.bulkUploadQuestions = async (req, res) => {
  try {
    const { chapter_id, questions } = req.body;

    // Mapping the data to match your Supabase column names
    const formattedQuestions = Object.values(questions).map(q => {
      // Map the string "option A", "option B" etc., to the actual text content
      const answerKey = q["correct answer"];
      const correctAnswerText = q[answerKey];

      return {
        chapter_id: chapter_id,
        question_text: q.question,
        // Converting options into the array format your DB expects
        options: [q["option A"], q["option B"], q["option C"], q["option D"]],
        correct_answer: correctAnswerText, // Updated to your DB column name
        explanation: q.explanation || ""
      };
    });

    const { data, error } = await supabase
      .from('questions')
      .insert(formattedQuestions)
      .select();

    if (error) throw error;

    res.status(201).json({ message: `Successfully uploaded ${data.length} questions` });
  } catch (error) {
    console.error("Bulk Upload Error:", error.message);
    res.status(500).json({ error: error.message });
  }
};