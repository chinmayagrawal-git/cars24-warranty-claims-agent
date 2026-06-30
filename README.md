# Cars24 Warranty Claims Triage Console

A self-initiated demo: an internal ops console for adjudicating used-car warranty claims under Cars24's **Lifetime Warranty Plan**. It auto-decides the clear cases with the clause cited, escalates the genuinely ambiguous ones with a handover note, and includes a **live agent** that adjudicates a fresh claim in real time.

Synthetic data throughout. The rubric reflects Cars24's publicly published Lifetime Warranty Plan terms (coverage, exclusions, void conditions). Not connected to any live claims system.

## Structure

- `index.html` — the console (4 views: How it works, Insights, Claims queue, Live agent). Single file, vanilla JS, no build step.
- `netlify/functions/adjudicate.js` — server-side Groq proxy. Holds the API key, runs the symptom through the rubric, returns a structured decision.
- `netlify.toml` — Netlify config.

## How the live agent works

1. The form collects vehicle facts + a freeform symptom.
2. **Void checks run in the browser, deterministically** (missed service, age/mileage cap, commercial use, ownership transfer, lapsed renewal). A void condition denies outright and is never sent to the model — mirroring "check void first."
3. If the warranty holds, only the symptom is sent to the proxy, which calls Groq (`llama-3.3-70b-versatile`, `temperature: 0`) to judge coverage / exclusion / ambiguity and return structured JSON. Anything malformed safely resolves to **Escalated**.

The API key lives only in the serverless function, never in the page.

## Run locally

```bash
npm i -g netlify-cli       # if not installed
cp .env.example .env        # add your Groq key (free tier at console.groq.com)
netlify dev                 # serves index.html + the function
```

## Deploy

```bash
netlify deploy --prod
```
Set `GROQ_API_KEY` in Netlify → Site → Environment variables. Free tier (1,000 requests/day) is ample for a demo.
