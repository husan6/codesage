import { Router } from 'express';
import { analyzeCode, type ReviewFocus } from '../openai.js';
import { analyzeGitHubUrl, getGitHubRepositorySummary, listGitHubPullRequests } from '../github.js';

const router = Router();

router.post('/', async (req, res) => {
  const { code, filename, focus } = req.body as {
    code?: unknown;
    filename?: unknown;
    focus?: unknown;
  };

  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'Code is required in the request body.' });
  }

  if (!code.trim()) {
    return res.status(400).json({ error: 'Code cannot be empty.' });
  }

  if (code.length > 120_000) {
    return res.status(400).json({ error: 'Code payload is too large. Please review a smaller file or snippet.' });
  }

  const normalizedFocus = normalizeFocus(focus);

  try {
    const review = await analyzeCode({
      code,
      filename: typeof filename === 'string' ? filename : undefined,
      focus: normalizedFocus,
    });

    return res.json(review);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Review failed. Please try again later.' });
  }
});

router.post('/github', async (req, res) => {
  const { url, focus } = req.body as {
    url?: unknown;
    focus?: unknown;
  };

  if (!url || typeof url !== 'string' || !url.trim()) {
    return res.status(400).json({ error: 'GitHub URL is required in the request body.' });
  }

  const normalizedFocus = normalizeFocus(focus);

  try {
    const review = await analyzeGitHubUrl({
      url: url.trim(),
      focus: normalizedFocus,
    });

    return res.json(review);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'GitHub review failed.';
    const statusCode = message.toLowerCase().includes('required') || message.toLowerCase().includes('valid') || message.toLowerCase().includes('use a github')
      ? 400
      : 502;

    return res.status(statusCode).json({ error: message });
  }
});

router.get('/github/repository', async (req, res) => {
  const repository = typeof req.query.repository === 'string' ? req.query.repository.trim() : '';

  if (!repository) {
    return res.status(400).json({ error: 'Repository query parameter is required.' });
  }

  try {
    const summary = await getGitHubRepositorySummary(repository);
    return res.json(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'GitHub repository lookup failed.';
    return res.status(message.toLowerCase().includes('required') || message.toLowerCase().includes('use a') ? 400 : 502).json({ error: message });
  }
});

router.get('/github/pulls', async (req, res) => {
  const repository = typeof req.query.repository === 'string' ? req.query.repository.trim() : '';

  if (!repository) {
    return res.status(400).json({ error: 'Repository query parameter is required.' });
  }

  try {
    const pulls = await listGitHubPullRequests(repository);
    return res.json({ repository, pulls });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'GitHub pull request lookup failed.';
    return res.status(message.toLowerCase().includes('required') || message.toLowerCase().includes('use a') ? 400 : 502).json({ error: message });
  }
});

function normalizeFocus(value: unknown): ReviewFocus {
  if (value === 'security' || value === 'quality' || value === 'performance') {
    return value;
  }

  return 'full';
}

export default router;
