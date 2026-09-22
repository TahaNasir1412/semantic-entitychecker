// api/generate.js
//
// This is the ONLY place your AI keys live. It runs on Vercel's server,
// never in the browser, so they're never visible to anyone who opens the
// page or views its source. The frontend (kw_tool.html) calls this endpoint
// instead of calling any AI provider directly.
//
// Setup: in your Vercel project settings -> Environment Variables, add:
//   GEMINI_API_KEY = your Gemini key (primary)
//   GROQ_API_KEY   = your Groq key (fallback -- optional, but recommended)
// Never put either key in this file or anywhere in the repo.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { prompt, json, tier, maxTokens } = req.body || {};
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid "prompt" in request body' });
  }

  const geminiKey = process.env.GEMINI_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;
  if (!geminiKey && !groqKey) {
    return res.status(500).json({ error: 'Server misconfigured: neither GEMINI_API_KEY nor GROQ_API_KEY is set in Vercel environment variables' });
  }

  // Frontend can request more room for calls that genuinely need it (e.g. heading
  // optimization scales this by how many headings were submitted). Capped at
  // 16384 so a bad input can't cause a runaway-cost request.
  const scaledMaxTokens = Math.min(16384, Math.max(4096, Number(maxTokens) || 4096));

  const attempts = []; // every failure across every provider/model, for real diagnostics

  // ---------- PRIMARY: Gemini ----------
  // Cost/token efficiency: always use a Flash-tier model, never Pro -- this tool's
  // tasks don't need frontier reasoning. IMPORTANT: Gemini 3.x "-preview" models are
  // paid-tier only as of 2026 -- a free AI Studio key gets an access error on those.
  // Order tries confirmed free-tier-stable models first, GA models next, preview last.
  if (geminiKey) {
    const modelCandidates = tier === 'quick'
      ? ['gemini-2.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3-flash-preview']
      : ['gemini-2.5-flash', 'gemini-3.1-flash-lite', 'gemini-3-flash-preview'];

    const generationConfig = { maxOutputTokens: scaledMaxTokens };
    if (json) generationConfig.responseMimeType = 'application/json';

    for (const model of modelCandidates) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
      try {
        const geminiRes = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig })
        });

        if (!geminiRes.ok) {
          attempts.push({ provider: 'gemini', model, status: geminiRes.status, detail: await geminiRes.text() });
          continue; // this model is unavailable/retired/rate-limited -- try the next one
        }

        const data = await geminiRes.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (text === undefined) {
          attempts.push({ provider: 'gemini', model, status: 500, detail: 'No usable content in response' });
          continue;
        }

        if (json) {
          try {
            return res.status(200).json(JSON.parse(text));
          } catch (parseErr) {
            const looksTruncated = !/[\]\}]\s*$/.test(text.trim());
            attempts.push({
              provider: 'gemini', model, status: 500,
              detail: looksTruncated ? 'response was cut off before finishing' : 'did not return valid JSON',
              raw: text.slice(-300)
            });
            continue; // don't give up -- try the next Gemini model, then Groq
          }
        }

        return res.status(200).json({ text });
      } catch (err) {
        attempts.push({ provider: 'gemini', model, status: 500, detail: err.message });
      }
    }
  }

  // ---------- FALLBACK: Groq ----------
  // Only reached if every Gemini candidate above failed. Same provider/model as
  // the Alphabet Soup tool: OpenAI-compatible chat completions endpoint,
  // gpt-oss-120b. Kept as a genuinely separate provider (different infrastructure,
  // different rate limits) so a Gemini-side outage or quota issue doesn't take
  // the whole tool down with it.
  if (groqKey) {
    try {
      const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
        body: JSON.stringify({
          model: 'openai/gpt-oss-120b',
          max_tokens: scaledMaxTokens,
          temperature: 0.3,
          messages: [{ role: 'user', content: prompt }],
          ...(json ? { response_format: { type: 'json_object' } } : {})
        })
      });

      if (!groqRes.ok) {
        attempts.push({ provider: 'groq', model: 'openai/gpt-oss-120b', status: groqRes.status, detail: await groqRes.text() });
      } else {
        const data = await groqRes.json();
        const text = data?.choices?.[0]?.message?.content;

        if (text === undefined) {
          attempts.push({ provider: 'groq', status: 500, detail: 'No usable content in response' });
        } else if (json) {
          try {
            return res.status(200).json(JSON.parse(text));
          } catch (parseErr) {
            attempts.push({ provider: 'groq', status: 500, detail: 'did not return valid JSON', raw: text.slice(-300) });
          }
        } else {
          return res.status(200).json({ text });
        }
      }
    } catch (err) {
      attempts.push({ provider: 'groq', status: 500, detail: err.message });
    }
  }

  // Every provider and model failed -- return the full attempt log so the real
  // cause (a dead model name, a bad key, a genuine outage) is visible immediately
  // instead of a bare "500".
  return res.status(502).json({
    error: 'All providers failed.' + (groqKey ? '' : ' GROQ_API_KEY is not set -- add it in Vercel for a fallback provider.'),
    attempts
  });
}
