// api/chat.js
//
// This is a Vercel Serverless Function. It runs on Vercel's servers, not in
// the browser — so the GEMINI_API_KEY environment variable it uses is never
// exposed to anyone visiting the site.
//
// The two AI features on the site (the discovery-call assistant on
// booking.html and the intake assistant embedded in index.html) call this
// endpoint. This function forwards those requests to Google's Gemini API,
// which has a genuinely free tier (no credit card required) — see
// https://ai.google.dev/gemini-api/docs/pricing
//
// NOTE ON DATA: Google's free tier may use API inputs/outputs to improve
// their models (see their terms). For a coaching site where people may
// share personal context in chat, it's worth knowing this trade-off exists
// on the free tier. It does not apply once billing is enabled on the
// Google Cloud project.
//
// SETUP REQUIRED ON VERCEL:
// 1. Get a free API key at https://aistudio.google.com/app/apikey
//    (sign in with any Google account — no credit card needed).
// 2. In your Vercel project, go to Settings → Environment Variables.
// 3. Add a variable named GEMINI_API_KEY with that key as the value.
//    Check it for Production (and Preview/Development if you want local
//    testing to work too).
// 4. Redeploy after adding the variable — Vercel only picks up new env
//    vars on a fresh deployment.
//
// IMPORTANT: this function keeps the exact same request/response shape the
// frontend already expects ({ system, messages, max_tokens } in, Claude-style
// { content: [{ type: "text", text }] } out) — so index.html and
// booking.html did not need to change at all when switching providers.

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY is not set in environment variables.');
    return res.status(500).json({ error: 'Server is not configured correctly.' });
  }

  const { system, messages, max_tokens } = req.body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Request must include a non-empty "messages" array.' });
  }

  // Translate the Claude-style messages array (role: "user"/"assistant")
  // into Gemini's contents array (role: "user"/"model", with text wrapped
  // in a "parts" array).
  const contents = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));

  const geminiBody = {
    contents: contents,
    generationConfig: {
      maxOutputTokens: max_tokens || 1000
    }
  };

  if (system) {
    geminiBody.systemInstruction = {
      parts: [{ text: system }]
    };
  }

  try {
    const geminiResponse = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify(geminiBody)
    });

    const data = await geminiResponse.json();

    if (!geminiResponse.ok) {
      console.error('Gemini API error:', data);
      return res.status(geminiResponse.status).json({
        error: data?.error?.message || 'Upstream API error'
      });
    }

    // Gemini sometimes blocks a response for safety reasons and returns no
    // candidates, or a candidate with no text part. Handle that gracefully
    // instead of throwing when we try to read .text below.
    const candidate = data?.candidates?.[0];
    const text = candidate?.content?.parts?.map((p) => p.text || '').join('') || '';

    if (!text) {
      console.error('Gemini returned no usable text. Full response:', JSON.stringify(data));
      return res.status(502).json({
        error: 'The AI did not return a usable response. Please try rephrasing.'
      });
    }

    // Reshape into the same format the frontend already expects from the
    // old Claude-based version of this function, so index.html and
    // booking.html require no changes.
    return res.status(200).json({
      content: [{ type: 'text', text: text }]
    });

  } catch (err) {
    console.error('Error calling Gemini API:', err);
    return res.status(500).json({ error: 'Failed to reach the AI service. Please try again.' });
  }
}
