// controllers/contentController.js
const supabase = require('../config/supabaseClient');

// 1. Fetch all available subjects
exports.getSubjects = async (req, res) => {
  try {
    const { type } = req.query; // This will be 'is_flashcard' or 'is_question'

    // Validation to prevent SQL injection or errors
    const validTypes = ['is_flashcard', 'is_question'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: "Invalid content type specified" });
    }

    const { data, error } = await supabase
      .from('subjects')
      .select(`
        *,
        chapters!inner(id) 
      `)
      .eq(`chapters.${type}`, true);

    if (error) throw error;

    // The inner join might return duplicate subjects if multiple chapters match.
    // However, Supabase's PostgREST logic typically handles the grouping. 
    // To be safe and return clean subject objects, we can map them:
    const formattedData = data.map(subject => {
      const { chapters, ...subjectInfo } = subject;
      return subjectInfo;
    });

    // Remove duplicates if any (PostgREST usually prevents them in this select style, 
    // but this is a safe way to ensure a unique list of subjects)
    const uniqueSubjects = Array.from(new Map(formattedData.map(s => [s.id, s])).values());

    res.status(200).json(uniqueSubjects);
  } catch (err) {
    console.error("Subject Fetch Error:", err.message);
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
  const userId = req.user?.id || req.user?.sub;

  if (!userId || userId === 'undefined') {
    return res.status(401).json({ error: "User ID not found in token" });
  }

  try {
    const { data, error } = await supabase
      .from('questions')
      .select(`
        id, 
        question_text, 
        question_image,
        options, 
        chapter_id, 
        likes_count,
        order_index,
        user_likes!left(user_id) 
      `)
      .eq('chapter_id', chapterId)
      .eq('is_active', true)
      .eq('user_likes.user_id', userId)
      .order('order_index', { ascending: true });

    if (error) {
      console.error("Supabase Query Error:", error);
      throw error;
    }

    const formattedData = data.map(q => ({
      id: q.id,
      question_text: q.question_text,
      question_image: q.question_image,
      options: q.options,
      chapter_id: q.chapter_id,
      likes_count: q.likes_count || 0,
      hasLiked: q.user_likes && q.user_likes.length > 0,
      order_index: q.order_index || 0
    }));

    res.status(200).json(formattedData);
  } catch (err) {
    console.error("Full Controller Error:", err);
    res.status(500).json({ error: "Could not fetch questions" });
  }
};

exports.getExplanations = async (req, res) => {
  const { chapterId } = req.params;

  try {
    // Query the database for explanations AND images
    const { data, error } = await supabase
      .from('questions')
      .select('id, explanation, explanation_image, correct_answer')
      .eq('chapter_id', chapterId);

    if (error) throw error;

    // Convert array to key-value object
    const explanationMap = data.reduce((acc, item) => {
      acc[item.id] = {
        explanation: item.explanation,
        explanation_image: item.explanation_image,
        correct_answer: item.correct_answer
      };
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

// GET subjects that actually have flashcards
exports.getFlashcardSubjects = async (req, res) => {
  const { data, error } = await supabase
    .from('subjects')
    .select('*, chapters!inner(flashcards!inner(id))'); // Only get subjects with flashcards
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
};

// GET chapters with progress stats
exports.getFlashcardChapters = async (req, res) => {
  const { subjectId } = req.params;
  const userId = req.user.id; // from auth middleware

  // Call the SQL function we created
  const { data, error } = await supabase
    .rpc('get_flashcard_chapter_stats', { u_id: userId });

  if (error) return res.status(400).json({ error: error.message });

  // Filter for the specific subject if needed (or adjust RPC to accept subject_id)
  // For now, assuming we filter in JS or adjust RPC. 
  // Simplified for this context:
  const { data: chapters } = await supabase
    .from('chapters')
    .select('id, title, flashcards(count)')
    .eq('subject_id', subjectId);

  res.json(chapters);
};

// GET the actual cards for the game
exports.getFlashcardsForChapter = async (req, res) => {
  const { chapterId } = req.params;
  const { data, error } = await supabase
    .from('flashcards')
    .select('*')
    .eq('chapter_id', chapterId);
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
};

// POST track when a user flips a card
exports.trackFlashcardInteraction = async (req, res) => {
  const { flashcardId, type } = req.body; // type = 'flip' or 'like'
  const userId = req.user.id;

  const updateData = type === 'flip' ? { is_flipped: true } : { liked: true };

  const { error } = await supabase
    .from('user_flashcard_progress')
    .upsert({ user_id: userId, flashcard_id: flashcardId, ...updateData }, { onConflict: 'user_id, flashcard_id' });

  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
};