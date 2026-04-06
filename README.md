# CodeSage

CodeSage is a premium AI-powered code reviewer built with React, Vite, Express, and OpenAI. It works in two honest modes:

- `Local review engine`: deterministic checks for bugs, security smells, complexity, and maintainability.
- `OpenAI + local checks`: hybrid analysis when `OPENAI_API_KEY` is configured on the server.

## What it does

- Paste code or upload a source file for review
- Review a GitHub pull request URL or GitHub file URL
- Browse a GitHub repository and select an open pull request directly in the UI
- Rank findings by severity and confidence
- Surface line-aware bug, security, complexity, and style issues
- Return language detection, quality score, risk level, strengths, and code metrics
- Support focused review modes: full, security, quality, and performance

## Project structure

- `frontend/` - React + Tailwind + Vite UI
- `server/` - Express API and review engine

## Quick start

1. Install dependencies at the repo root:
   - `npm install`
2. Start the backend:
   - `npm run dev --workspace server`
3. Start the frontend:
   - `npm run dev --workspace frontend`
4. Open `http://localhost:5173`

## Environment

Create `server/.env` from `server/.env.example` if you want hybrid AI reviews:

```env
OPENAI_API_KEY=your-openai-api-key
OPENAI_MODEL=gpt-5.2
GITHUB_TOKEN=your-github-token
PORT=4000
```

Optional frontend override:

```env
VITE_API_BASE_URL=http://localhost:4000
```

If `OPENAI_API_KEY` is missing, CodeSage still works using the built-in local review engine.

If `GITHUB_TOKEN` is missing, CodeSage can still review public GitHub PRs and file URLs, but private repos and rate-limited API calls will be restricted.

## Verification

TypeScript checks pass with:

```bash
npx tsc --noEmit -p server/tsconfig.json
npx tsc --noEmit -p frontend/tsconfig.json
```

## Deployment

Frontend:

- Deploy the `frontend/` folder to Vercel
- Set `VITE_API_BASE_URL` to your deployed backend URL
- A starter Vercel config is included at `frontend/vercel.json`

Backend:

- Deploy `server/` to Render using `render.yaml`, or use the same settings on Railway
- Required env vars: `OPENAI_API_KEY`
- Recommended env vars: `OPENAI_MODEL`, `GITHUB_TOKEN`

Exact step-by-step commands and setup notes are in `DEPLOYMENT.md`.
