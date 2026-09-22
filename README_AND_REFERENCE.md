# Semantic Entity Checker — Complete Reference

## PART 1 — What's in this package

```
deploy_package/
├── api/
│   └── generate.js       <- Vercel serverless function. Holds your AI keys. Never touches the browser.
├── public/
│   └── index.html        <- The tool itself.
├── package.json
├── vercel.json
└── .gitignore
```

Same architecture as the Keyword Distribution Workbench: your keys live only in Vercel's environment variables, read only by `api/generate.js`. The frontend never calls Gemini or Groq directly.

---

## PART 2 — Deployment steps

1. **Get a Gemini key:** https://aistudio.google.com/apikey → Create API key (required)
2. **Get a Groq key:** https://console.groq.com → API Keys (optional but recommended fallback)
3. **Push this folder to GitHub** as its own repo — `api/` and `public/` must stay at the top level
4. **Import into Vercel** (https://vercel.com/new), don't deploy yet
5. **Add environment variables** under Settings → Environment Variables:
   - `GEMINI_API_KEY` = your Gemini key
   - `GROQ_API_KEY` = your Groq key (if you have one)
6. **Deploy.** Vercel gives you a live URL.

**For any future change:** edit the file locally, then `git add . && git commit -m "..." && git push`. Vercel auto-redeploys.

---

## PART 3 — How the tool works

### The core checking logic (no AI involved — pure JavaScript)
For every entity in your list, checked against your pasted content:
- **Green (used):** the exact phrase found, word-boundary matched (so "drum" doesn't false-match inside a longer word).
- **Amber (partial):** for a multi-word entity, some but not all of its words appear somewhere in the content, even if not adjacent. For a single-word entity, a simple singular/plural stem check catches the other form (e.g. "bearing" present when the entity was "bearings").
- **Red (missing):** genuinely absent, not even a partial word overlap.

This part runs entirely client-side — no AI call, no cost, instant, and exactly reproducible every time you run it. This is deliberate: classification is a deterministic fact (a phrase either appears in the text or it doesn't), so it should never depend on a model's judgment.

### The visual meter
A segmented bar plus a headline percentage, computed directly from the green/amber/red counts above — no separate calculation, no AI involvement.

### Feature: research additional entities (AI, with real web search)
This is the one feature that genuinely needs live search, not just a cleverly-worded prompt. The backend enables Gemini's built-in Google Search grounding tool for this specific call — the model actually searches, finds real pages, and returns entities it found those pages using that aren't in your list yet. The response includes which pages it actually drew from, shown as source links, so the suggestions aren't an unverifiable claim.

**Important limitation, stated plainly:** Groq has no equivalent search capability. If Gemini fails and the call falls back to Groq, the response is explicitly flagged in the UI as "not based on a live search" — Groq can only offer its general training knowledge for this specific feature, not a real check of current pages. Every other feature in this tool works identically regardless of which provider answers; this one is the exception, and the tool tells you when that's happened rather than silently presenting stale suggestions as fresh research.

### Feature: naturally insert missing entities (AI, large-output)
Takes your full original content plus the exact list of currently-red entities, and asks the model to make the smallest possible edits — extending an existing sentence, adding a clause, adding one short sentence next to something related — rather than rewriting anything. The prompt explicitly tells the model to leave an entity out rather than force it in unnaturally, and to leave every sentence that doesn't need a change exactly as it was.

**Sized for up to ~10,000 words of content:** the requested output token budget scales with your actual word count (roughly 1.6 tokens per word plus a buffer), capped at 32,768 tokens server-side. Longer content genuinely takes longer to process — the UI shows a "this may take a minute" note above roughly 2,000 words rather than leaving you wondering if it's stuck.

**After the rewrite comes back, the tool automatically re-checks it** — using the same deterministic client-side logic from Part 3's core section, not another AI call — and tells you plainly whether every previously-red entity actually got resolved, or names the ones that still didn't fit naturally. This is how you verify the edit actually worked, rather than trusting the model's own claim about what it did.

---

## PART 4 — The AI backend, specifically

### Two providers, same pattern as the Keyword Workbench
Gemini first, Groq as fallback if every Gemini model fails. Groq needs its own key (`GROQ_API_KEY`) — without it, the tool still works, it just has no fallback if Gemini has an outage.

### Why request sizes vary so much across features
This tool has two very different call shapes: small classification/research calls (a few hundred to a couple thousand tokens) and full-content rewrites of up to ~10,000 words (roughly 13,000-14,000 tokens of output on their own). A single fixed token cap or timeout breaks one or the other, so both scale with what the specific request actually needs:
- Small calls: capped around 4,096 tokens, 12-second per-attempt timeout.
- Large calls (rewrite requests over 8,192 tokens): up to 32,768 tokens, 55-second per-attempt timeout on Gemini, 45 seconds on Groq.

`vercel.json`'s `maxDuration` is set to 240 seconds specifically to give the large-call worst case (three Gemini attempts plus a Groq fallback, each near their timeout ceiling) enough room to actually complete instead of getting killed by the platform mid-fallback.

### Free tier vs. preview models, and model retirement
Same caveats as the Keyword Workbench: Gemini's `-preview` models are paid-tier only as of 2026, and Google has been retiring model names fast (`gemini-2.0-flash`/`flash-lite` were both shut down mid-2026). The model candidate list tries confirmed free-tier-stable models first, then GA models, then preview last. If this list goes stale, check `ai.google.dev/gemini-api/docs/models` and update `modelCandidates` in `api/generate.js`.

### Diagnosing a live failure
Open the browser console (F12 → Console) when something fails — the response body's `attempts` array lists every provider and model actually tried, with the real status and error for each.

---

## PART 5 — Getting future help

Describe what's wrong, and when something fails live, paste the exact browser console error. That's what turns "guess and patch" into "diagnose and fix" — every real bug in the companion Keyword Workbench project was solved that way, not by re-reading code and assuming.
