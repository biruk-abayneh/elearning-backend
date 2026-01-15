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

exports.createSubject = async (subjectData) => {
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_URL}/subjects`, {
    method: 'POST',
    headers,
    body: JSON.stringify(subjectData),
  });

  const contentType = response.headers.get("content-type");

  if (contentType && contentType.indexOf("application/json") !== -1) {
    return await response.json();
  } else {
    // This will capture the HTML error page as text and log it
    const textError = await response.text();
    console.log("SERVER RETURNED NON-JSON:", textError);
    return { error: "Server returned HTML instead of JSON. Check route path." };
  }
};

exports.createChapter = async (req, res) => {
  const { subject_id, chapter_name } = req.body;
  const { data, error } = await supabase
    .from('chapters')
    .insert([{ subject_id, name }])
    .select();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data[0]);
};

