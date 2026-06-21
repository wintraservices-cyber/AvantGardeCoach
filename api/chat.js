// api/chat.js
//
// This is a Vercel Serverless Function. It runs on Vercel's servers, not in
// the browser — so the ANTHROPIC_API_KEY environment variable it uses is
// never exposed to anyone visiting the site.
//
// The two AI features on the site (the discovery-call assistant on
// booking.html and the intake assistant embedded in index.html) call this
// endpoint instead of calling api.anthropic.com directly.
//
// SETUP REQUIRED ON VERCEL:
// 1. In your Vercel project settings, go to Settings → Environment Variables.
// 2. Add a variable named ANTHROPIC_API_KEY with your real Anthropic API key
//    as the value. Do this for Production (and Preview/Development if you
//    want local testing to work too).
// 3. Redeploy after adding the variable — Vercel only picks up new env vars
//    on a fresh deployment.

export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY is not set in environment variables.');
    return res.status(500).json({ error: 'Server is not configured correctly.' });
  }

  const { system, messages, max_tokens } = req.body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Request must include a non-empty "messages" array.' });
  }

  try {
    const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: max_tokens || 1000,
        system: system || undefined,
        messages: messages
      })
    });

    const data = await anthropicResponse.json();

    if (!anthropicResponse.ok) {
      console.error('Anthropic API error:', data);
      return res.status(anthropicResponse.status).json({
        error: data?.error?.message || 'Upstream API error'
      });
    }

    return res.status(200).json(data);

  } catch (err) {
    console.error('Error calling Anthropic API:', err);
    return res.status(500).json({ error: 'Failed to reach the AI service. Please try again.' });
  }
}
