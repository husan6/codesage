# CodeSage Deployment Guide

This repo is ready for:

- Frontend: Vercel
- Backend: Render

## 1. Deploy the backend on Render

### Option A: Render dashboard

1. Push this repo to GitHub.
2. Open Render.
3. Click `New +` -> `Blueprint`.
4. Select this repository.
5. Render will detect `render.yaml`.
6. Create the service.

### Option B: Manual web service settings

Use these values:

- Root directory: `server`
- Runtime: `Node`
- Build command: `npm install && npm run build`
- Start command: `npm run start`

### Backend environment variables

Set these in Render:

- `OPENAI_API_KEY=your_real_openai_key`
- `OPENAI_MODEL=gpt-5.2`
- `GITHUB_TOKEN=your_github_token`
- `PORT=4000`

### Backend verification

After deploy, open:

```text
https://your-render-url.onrender.com/api/status
```

Expected shape:

```json
{
  "status": "ok",
  "aiEnabled": true,
  "model": "gpt-5.2",
  "githubTokenConfigured": true
}
```

## 2. Deploy the frontend on Vercel

### Option A: Vercel dashboard

1. Open Vercel.
2. Click `Add New` -> `Project`.
3. Import this repository.
4. Set the root directory to `frontend`.
5. Vercel should use the included `frontend/vercel.json`.

### Option B: Vercel CLI

From the repo root:

```bash
cd frontend
npm install -g vercel
vercel
```

When prompted:

- Set up and deploy: `Y`
- Scope: your account/team
- Link to existing project: `N` unless you already created one
- Project name: `codesage-frontend` or your preferred name
- Directory: `.` because you are already inside `frontend`

### Frontend environment variable

Set this in Vercel:

- `VITE_API_BASE_URL=https://your-render-url.onrender.com`

## 3. Final production wiring

After both deploys:

1. Open the Vercel site.
2. Confirm the dashboard loads.
3. Run a snippet review.
4. Run a GitHub review.
5. Confirm no browser request still points to `localhost`.

## 4. Local pre-deploy checklist

Run these from the repo root:

```bash
npx tsc --noEmit -p server/tsconfig.json
npx tsc --noEmit -p frontend/tsconfig.json
npm run build --workspace server
npm run build --workspace frontend
```

## 5. Quick launch checklist

- Repo pushed to GitHub
- Render backend created
- `OPENAI_API_KEY` set on Render
- `GITHUB_TOKEN` set on Render
- Backend `/api/status` returns `ok`
- Vercel frontend created with root `frontend`
- `VITE_API_BASE_URL` points to Render backend
- Frontend snippet review works
- Frontend GitHub review works
