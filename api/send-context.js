// api/send-context.js
//
// Sends the discovery-call context note to Mahal's team, via Resend's
// email API. This function is ONLY called after the visitor has reviewed
// the exact email text and explicitly clicked "Send" in the UI — there is
// no automatic/background sending anywhere in this flow.
//
// SETUP REQUIRED ON VERCEL:
// 1. Create a free Resend account at https://resend.com and get an API key
//    from the dashboard (Settings → API Keys).
// 2. In your Vercel project, go to Settings → Environment Variables.
// 3. Add a variable named RESEND_API_KEY with that key as the value.
// 4. Redeploy after adding the variable.
//
// DOMAIN VERIFICATION (do this when ready — not required to test today):
// Resend's free tier requires a verified sending domain to deliver to
// arbitrary recipients. Until avant-gardecoach.ca (or a subdomain) is
// verified in Resend (Domains → Add Domain → add the DNS records they
// give you), sending is limited to the email address on your own Resend
// account — useful for testing, not yet for real visitor traffic. Once
// verified, change FROM_ADDRESS below to something like
// "Avant-Garde Coach <hello@avant-gardecoach.ca>".

const FROM_ADDRESS = 'Avant-Garde Coach <onboarding@resend.dev>'; // TEMP: Resend's shared test sender. Replace once your domain is verified.
const TO_ADDRESS = 'hello@avant-gardecoach.ca'; // Where the context note is delivered.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('RESEND_API_KEY is not set in environment variables.');
    return res.status(500).json({ error: 'Email sending is not configured yet.' });
  }

  const { contextNote, replyToEmail } = req.body || {};

  if (!contextNote || typeof contextNote !== 'string' || contextNote.trim().length === 0) {
    return res.status(400).json({ error: 'Missing context note to send.' });
  }

  // Basic length guard so this endpoint can't be abused to send huge payloads.
  const safeNote = contextNote.slice(0, 4000);

  const textBody = `Hi Mahal,\n\nSomeone used the booking assistant on the site and reviewed and approved sending you this note before their discovery call:\n\n"${safeNote}"\n\nThis was sent only after they explicitly approved it — nothing is sent automatically.\n\n— Avant-Garde Coach booking assistant`;

  const payload = {
    from: FROM_ADDRESS,
    to: [TO_ADDRESS],
    subject: 'New discovery call inquiry — context from chat',
    text: textBody
  };

  // If the visitor provided their own email (optional, not required), set
  // reply-to so Mahal can respond directly to them.
  if (replyToEmail && typeof replyToEmail === 'string' && replyToEmail.includes('@')) {
    payload.reply_to = replyToEmail;
  }

  try {
    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await resendResponse.json();

    if (!resendResponse.ok) {
      console.error('Resend API error:', data);
      return res.status(resendResponse.status).json({
        error: data?.message || 'Email service rejected the request.'
      });
    }

    return res.status(200).json({ success: true, id: data?.id || null });

  } catch (err) {
    console.error('Error calling Resend API:', err);
    return res.status(500).json({ error: 'Failed to send the email. Please try again, or email hello@avant-gardecoach.ca directly.' });
  }
}
