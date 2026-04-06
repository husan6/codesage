import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import reviewRouter from './routes/review.js';

dotenv.config();

const app = express();
const port = process.env.PORT ? Number(process.env.PORT) : 4000;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/', (_, res) => {
  res.json({ status: 'ok', message: 'CodeSage review backend is running.' });
});

app.get('/api/status', (_, res) => {
  res.json({
    status: 'ok',
    aiEnabled: Boolean(process.env.OPENAI_API_KEY),
    model: process.env.OPENAI_MODEL || 'gpt-5.2',
    githubTokenConfigured: Boolean(process.env.GITHUB_TOKEN),
  });
});

app.use('/api/review', reviewRouter);

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
