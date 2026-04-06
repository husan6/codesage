import { ChangeEvent, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ApiStatusResponse,
  GitHubPullRequestSummary,
  GitHubRepositorySummary,
  ReviewCategory,
  ReviewFocus,
  ReviewedFile,
  ReviewResponse,
  ReviewSeverity,
  ReviewSource,
  RiskLevel,
} from '../types';

const apiBase = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') ?? '';

const focusOptions: Array<{ value: ReviewFocus; label: string; caption: string }> = [
  {
    value: 'full',
    label: 'Premium sweep',
    caption: 'Balanced review across bugs, security, complexity, and maintainability.',
  },
  {
    value: 'security',
    label: 'Security-first',
    caption: 'Pushes vulnerable patterns and unsafe data handling to the top.',
  },
  {
    value: 'quality',
    label: 'Quality pass',
    caption: 'Focuses on correctness, readability, and maintainability.',
  },
  {
    value: 'performance',
    label: 'Performance pass',
    caption: 'Highlights dense control flow and heavier execution paths first.',
  },
];

const premiumChecks = [
  'Switch between snippet review and GitHub review without leaving the dashboard.',
  'Public GitHub URLs work immediately, and GITHUB_TOKEN unlocks private or rate-limited repos.',
  'When OpenAI is configured, CodeSage combines model reasoning with rule-based signals.',
  'Results stay honest: no fake PR history, no placeholder quality scores, no invented trends.',
];

const sampleSnippet = `type UserRecord = {
  id: string;
  isAdmin?: boolean;
  purchases: number[];
};

export async function renderUserSummary(users: any[], selectedUserId: string) {
  var total = 0;

  for (let index = 0; index <= users.length; index += 1) {
    const current = users[index];
    if (current && current.id == selectedUserId) {
      total += current.purchases.reduce((sum: number, value: number) => sum + value, 0);
      console.log('matched user', current.id);
    }
  }

  const summaryNode = document.getElementById('summary');
  if (summaryNode) {
    summaryNode.innerHTML = '<strong>Total:</strong> ' + total;
  }

  const response = await fetch('/api/users/' + selectedUserId);
  return response.json();
}`;

const exampleGitHubUrl = 'https://github.com/octocat/Hello-World/pull/1347';

const categoryOrder: ReviewCategory[] = ['Bug', 'Security', 'Complexity', 'Improvement', 'Style'];

const categoryStyles: Record<ReviewCategory, string> = {
  Bug: 'bg-rose-100 text-rose-700',
  Improvement: 'bg-amber-100 text-amber-800',
  Complexity: 'bg-sky-100 text-sky-700',
  Security: 'bg-emerald-100 text-emerald-700',
  Style: 'bg-violet-100 text-violet-700',
};

const severityStyles: Record<ReviewSeverity, string> = {
  Critical: 'bg-rose-600 text-white',
  High: 'bg-orange-500 text-white',
  Medium: 'bg-amber-200 text-amber-900',
  Low: 'bg-slate-200 text-slate-700',
};

const riskStyles: Record<RiskLevel, string> = {
  Low: 'bg-emerald-100 text-emerald-700',
  Medium: 'bg-amber-100 text-amber-800',
  High: 'bg-orange-100 text-orange-700',
  Critical: 'bg-rose-100 text-rose-700',
};

const sourceLabels: Record<ReviewSource, string> = {
  heuristic: 'Local review engine',
  hybrid: 'OpenAI + local checks',
};

type InputMode = 'snippet' | 'github';

function CodeReviewDashboard() {
  const [inputMode, setInputMode] = useState<InputMode>('snippet');
  const [code, setCode] = useState(sampleSnippet);
  const [filename, setFilename] = useState('sample-review.ts');
  const [githubRepositoryInput, setGitHubRepositoryInput] = useState('octocat/Hello-World');
  const [githubUrl, setGitHubUrl] = useState('');
  const [focus, setFocus] = useState<ReviewFocus>('full');
  const [result, setResult] = useState<ReviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [githubRepository, setGitHubRepository] = useState<GitHubRepositorySummary | null>(null);
  const [githubPullRequests, setGitHubPullRequests] = useState<GitHubPullRequestSummary[]>([]);
  const [githubLookupLoading, setGitHubLookupLoading] = useState(false);
  const [githubLookupError, setGitHubLookupError] = useState<string | null>(null);
  const [aiStatus, setAiStatus] = useState<ApiStatusResponse | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let active = true;

    async function loadStatus() {
      try {
        const response = await fetch(`${apiBase}/api/status`);
        if (!response.ok) {
          throw new Error('Unable to reach backend status endpoint.');
        }

        const data = (await response.json()) as ApiStatusResponse;
        if (active) {
          setAiStatus(data);
          setStatusError(null);
        }
      } catch (err) {
        if (active) {
          setStatusError(err instanceof Error ? err.message : 'Unable to connect to backend.');
        }
      }
    }

    void loadStatus();

    return () => {
      active = false;
    };
  }, []);

  const deferredCode = useDeferredValue(code);

  const draftLineCount = useMemo(() => {
    if (!deferredCode.trim()) {
      return 0;
    }

    return deferredCode.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
  }, [deferredCode]);

  const draftCharacterCount = deferredCode.trim().length;

  const suggestionCounts = useMemo(() => {
    const counts: Record<ReviewCategory, number> = {
      Bug: 0,
      Improvement: 0,
      Complexity: 0,
      Security: 0,
      Style: 0,
    };

    for (const suggestion of result?.suggestions ?? []) {
      counts[suggestion.category] += 1;
    }

    return counts;
  }, [result]);

  const selectedFocus = focusOptions.find((item) => item.value === focus) ?? focusOptions[0];
  const activeTargetLabel =
    result?.context?.label ??
    (inputMode === 'snippet' ? (filename || 'Pasted snippet') : githubUrl.trim() || 'GitHub target');
  const hasImprovedCode = Boolean(
    result?.originalCode &&
      result?.improvedCode &&
      result.originalCode.trim() !== result.improvedCode.trim(),
  );

  const overviewCards = useMemo(
    () => [
      {
        label: 'Target',
        value: activeTargetLabel,
        tone: 'text-slate-900 text-base',
      },
      {
        label: 'Language',
        value: result?.language ?? 'Waiting',
        tone: 'text-slate-900 text-3xl',
      },
      {
        label: 'Quality Score',
        value: result ? `${result.qualityScore}/100` : '--',
        tone: `${result && result.qualityScore >= 80 ? 'text-emerald-700' : 'text-slate-900'} text-3xl`,
      },
      {
        label: 'Risk Level',
        value: result?.riskLevel ?? 'Not scored',
        tone: 'text-slate-900 text-3xl',
      },
      {
        label: 'Findings',
        value: result ? String(result.suggestions.length) : '--',
        tone: 'text-slate-900 text-3xl',
      },
      {
        label: 'Review Source',
        value: result ? sourceLabels[result.source] : aiStatus?.aiEnabled ? 'AI ready' : 'Local ready',
        tone: 'text-slate-900 text-base',
      },
    ],
    [activeTargetLabel, aiStatus?.aiEnabled, inputMode, result],
  );

  async function submitReview() {
    if (!code.trim()) {
      setError('Paste code or upload a file before starting a review.');
      return;
    }

    await submitRequest('/api/review', {
      code,
      filename: filename || undefined,
      focus,
    });
  }

  async function submitGitHubReview() {
    if (!githubUrl.trim()) {
      setError('Paste a GitHub pull request URL or file URL before starting a review.');
      return;
    }

    await submitRequest('/api/review/github', {
      url: githubUrl.trim(),
      focus,
    });
  }

  async function submitRequest(endpoint: string, body: Record<string, unknown>) {

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch(`${apiBase}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = (await response.json()) as ReviewResponse | { error?: string };
      if (!response.ok) {
        throw new Error('error' in data && data.error ? data.error : 'Unable to analyze the target.');
      }

      setResult(data as ReviewResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  async function fetchGitHubRepository() {
    if (!githubRepositoryInput.trim()) {
      setGitHubLookupError('Enter a repository like owner/repo or a GitHub repo URL.');
      return;
    }

    setGitHubLookupLoading(true);
    setGitHubLookupError(null);

    try {
      const repoResponse = await fetch(
        `${apiBase}/api/review/github/repository?repository=${encodeURIComponent(githubRepositoryInput.trim())}`,
      );
      const repoData = (await repoResponse.json()) as GitHubRepositorySummary | { error?: string };
      if (!repoResponse.ok) {
        throw new Error('error' in repoData && repoData.error ? repoData.error : 'Unable to fetch repository.');
      }

      const pullsResponse = await fetch(
        `${apiBase}/api/review/github/pulls?repository=${encodeURIComponent(githubRepositoryInput.trim())}`,
      );
      const pullsData = (await pullsResponse.json()) as { repository: string; pulls: GitHubPullRequestSummary[] } | { error?: string };
      if (!pullsResponse.ok) {
        throw new Error('error' in pullsData && pullsData.error ? pullsData.error : 'Unable to fetch pull requests.');
      }

      setGitHubRepository(repoData as GitHubRepositorySummary);
      setGitHubPullRequests('pulls' in pullsData ? pullsData.pulls : []);
      setGitHubLookupError(null);
    } catch (err) {
      setGitHubRepository(null);
      setGitHubPullRequests([]);
      setGitHubLookupError(err instanceof Error ? err.message : 'Unable to browse GitHub repository.');
    } finally {
      setGitHubLookupLoading(false);
    }
  }

  function choosePullRequest(pullRequest: GitHubPullRequestSummary) {
    setGitHubUrl(pullRequest.url);
    setResult(null);
    setError(null);
  }

  function handleFileUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setFilename(file.name);
    setError(null);
    setResult(null);

    const reader = new FileReader();
    reader.onload = () => {
      setCode(typeof reader.result === 'string' ? reader.result : '');
    };
    reader.readAsText(file);
  }

  function clearReview() {
    setCode('');
    setFilename('');
    setResult(null);
    setError(null);

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  function loadSample() {
    setInputMode('snippet');
    setFilename('sample-review.ts');
    setCode(sampleSnippet);
    setResult(null);
    setError(null);

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  function loadSampleGitHub() {
    setInputMode('github');
    setGitHubRepositoryInput('octocat/Hello-World');
    setGitHubUrl(exampleGitHubUrl);
    setGitHubLookupError(null);
    setResult(null);
    setError(null);
  }

  return (
    <div className="mx-auto max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8">
      <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="rounded-[32px] border border-slate-200/70 bg-white/90 p-6 shadow-soft backdrop-blur">
          <div className="rounded-[28px] bg-slate-950 p-5 text-white">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-3xl bg-amber-300 text-lg font-bold text-slate-950">
                CS
              </div>
              <div>
                <p className="text-lg font-semibold">CodeSage</p>
                <p className="text-sm text-slate-300">Premium AI code reviewer</p>
              </div>
            </div>

            <p className="mt-5 text-sm leading-6 text-slate-300">
              Review real code, surface the risky parts first, and keep the output useful even when live AI is unavailable.
            </p>
          </div>

          <div className="mt-6 rounded-[28px] border border-slate-200 bg-slate-50 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
              Current Focus
            </p>
            <p className="mt-3 text-lg font-semibold text-slate-900">{selectedFocus.label}</p>
            <p className="mt-2 text-sm leading-6 text-slate-600">{selectedFocus.caption}</p>
          </div>

          <div className="mt-6">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
              Premium Standards
            </p>
            <div className="mt-4 space-y-3">
              {premiumChecks.map((item) => (
                <div key={item} className="rounded-3xl border border-slate-200 px-4 py-4 text-sm leading-6 text-slate-600">
                  {item}
                </div>
              ))}
            </div>
          </div>
        </aside>

        <main className="space-y-6">
          <section className="overflow-hidden rounded-[32px] bg-slate-950 p-6 text-white shadow-soft">
            <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.32em] text-amber-300">
                  AI Review Hub
                </p>
                <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
                  Review pasted code or GitHub targets with one premium workflow.
                </h1>
                <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300">
                  Paste a snippet, upload a file, or point CodeSage at a GitHub pull request or file URL. The same review engine returns ranked findings, quality score, risk, and expandable details.
                </p>
                <div className="mt-5 flex flex-wrap gap-3">
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${aiStatus?.aiEnabled ? 'bg-emerald-300 text-slate-950' : 'bg-white/10 text-slate-200'}`}>
                    {aiStatus?.aiEnabled ? `OpenAI live: ${aiStatus.model}` : 'Local engine active'}
                  </span>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${aiStatus?.githubTokenConfigured ? 'bg-sky-300 text-slate-950' : 'bg-white/10 text-slate-200'}`}>
                    {aiStatus?.githubTokenConfigured ? 'GitHub token ready' : 'Public GitHub mode'}
                  </span>
                  {statusError && (
                    <span className="rounded-full bg-rose-500/20 px-3 py-1 text-xs font-semibold text-rose-100">
                      Backend not reachable
                    </span>
                  )}
                </div>
              </div>

              <div className="rounded-[28px] bg-white/8 p-5 backdrop-blur">
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setInputMode('snippet');
                      setError(null);
                    }}
                    className={`rounded-3xl px-4 py-3 text-sm font-semibold transition ${inputMode === 'snippet' ? 'bg-amber-300 text-slate-950' : 'bg-white/10 text-white hover:bg-white/20'}`}
                  >
                    Snippet Review
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setInputMode('github');
                      setError(null);
                    }}
                    className={`rounded-3xl px-4 py-3 text-sm font-semibold transition ${inputMode === 'github' ? 'bg-amber-300 text-slate-950' : 'bg-white/10 text-white hover:bg-white/20'}`}
                  >
                    GitHub Review
                  </button>
                </div>

                <label className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-300">
                  Review Mode
                </label>
                <select
                  value={focus}
                  onChange={(event) => setFocus(event.target.value as ReviewFocus)}
                  className="mt-3 w-full rounded-3xl border border-white/10 bg-white/10 px-4 py-3 text-sm text-white outline-none transition focus:border-amber-300"
                >
                  {focusOptions.map((option) => (
                    <option key={option.value} value={option.value} className="text-slate-900">
                      {option.label}
                    </option>
                  ))}
                </select>

                <div className="mt-5 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={loadSample}
                    className="rounded-3xl bg-amber-300 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-amber-200"
                  >
                    Load demo snippet
                  </button>
                  <button
                    type="button"
                    onClick={inputMode === 'snippet' ? submitReview : submitGitHubReview}
                    disabled={loading || (inputMode === 'snippet' ? !code.trim() : !githubUrl.trim())}
                    className="rounded-3xl bg-white px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:bg-white/30 disabled:text-white/70"
                  >
                    {loading ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-700 border-t-transparent" />
                        Reviewing...
                      </span>
                    ) : (
                      inputMode === 'snippet' ? 'Run snippet review' : 'Run GitHub review'
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={loadSampleGitHub}
                    className="rounded-3xl bg-white/10 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/20"
                  >
                    Load GitHub example
                  </button>
                </div>
                <p className="mt-4 text-sm leading-6 text-slate-300">
                  {inputMode === 'snippet'
                    ? 'Sample code is preloaded so you can hit Analyze immediately and see a real review response.'
                    : 'Paste a GitHub PR or file URL to review public GitHub targets from the same dashboard.'}
                </p>
              </div>
            </div>
          </section>

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
            {overviewCards.map((item) => (
              <div key={item.label} className="rounded-[28px] border border-slate-200/70 bg-white/90 px-5 py-5 shadow-soft backdrop-blur">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-500">{item.label}</p>
                <p className={`mt-3 text-3xl font-semibold ${item.tone}`}>{item.value}</p>
              </div>
            ))}
          </section>

          {result && !loading && (
            <section className="rounded-[28px] border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-900 shadow-soft">
              Review complete for <span className="font-semibold">{activeTargetLabel}</span>. CodeSage generated {result.suggestions.length} finding{result.suggestions.length === 1 ? '' : 's'} and a score breakdown you can act on.
            </section>
          )}

          <section className="grid gap-6 xl:grid-cols-[1.4fr_0.9fr]">
            <article className="rounded-[32px] border border-slate-200/70 bg-white/90 p-6 shadow-soft backdrop-blur">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-lg font-semibold text-slate-900">
                    {inputMode === 'snippet' ? 'Upload or paste code' : 'Paste a GitHub PR or file URL'}
                  </p>
                  <p className="mt-2 text-sm text-slate-500">
                    {inputMode === 'snippet'
                      ? 'CodeSage accepts pasted snippets or plain-text source files for a fast review pass.'
                      : 'Public GitHub pull request URLs and file URLs can be reviewed directly from this panel.'}
                  </p>
                </div>

                {inputMode === 'snippet' ? (
                  <div className="flex flex-wrap gap-3">
                    <label className="inline-flex cursor-pointer items-center rounded-3xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-200">
                      Upload file
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".js,.ts,.tsx,.jsx,.py,.java,.go,.cs,.cpp,.c,.json,.txt"
                        className="hidden"
                        onChange={handleFileUpload}
                      />
                    </label>

                    <button
                      type="button"
                      onClick={clearReview}
                      className="rounded-3xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
                    >
                      Clear
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={loadSampleGitHub}
                    className="rounded-3xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
                  >
                    Use example URL
                  </button>
                )}
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-3 text-sm text-slate-500">
                {inputMode === 'snippet' ? (
                  <>
                    <span className="rounded-full bg-slate-100 px-3 py-1">
                      {filename ? `File: ${filename}` : 'File: pasted snippet'}
                    </span>
                    <span className="rounded-full bg-slate-100 px-3 py-1">{draftLineCount} lines loaded</span>
                    <span className="rounded-full bg-slate-100 px-3 py-1">{draftCharacterCount} characters</span>
                  </>
                ) : (
                  <>
                    <span className="rounded-full bg-slate-100 px-3 py-1">GitHub target</span>
                    <span className="rounded-full bg-slate-100 px-3 py-1">{githubUrl.trim() ? 'URL ready' : 'Waiting for URL'}</span>
                  </>
                )}
                <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-900">
                  Click Analyze to generate language, score, risk, and findings
                </span>
              </div>

              {inputMode === 'snippet' ? (
                <textarea
                  value={code}
                  onChange={(event) => {
                    setCode(event.target.value);
                    setResult(null);
                    setError(null);
                  }}
                  rows={16}
                  placeholder="Paste your code here or upload a source file to review..."
                  className="mt-5 min-h-[360px] w-full rounded-[28px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-6 text-slate-900 outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
                />
              ) : (
                <div className="mt-5">
                  <label className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Repository browser</label>
                  <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                    <input
                      value={githubRepositoryInput}
                      onChange={(event) => {
                        setGitHubRepositoryInput(event.target.value);
                        setGitHubLookupError(null);
                      }}
                      placeholder="owner/repo"
                      className="w-full rounded-[28px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-900 outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
                    />
                    <button
                      type="button"
                      onClick={fetchGitHubRepository}
                      disabled={githubLookupLoading || !githubRepositoryInput.trim()}
                      className="rounded-3xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      {githubLookupLoading ? 'Loading...' : 'Fetch PRs'}
                    </button>
                  </div>

                  {githubRepository && (
                    <div className="mt-4 rounded-[28px] border border-slate-200 bg-slate-50 p-5">
                      <div className="flex flex-wrap items-center gap-3">
                        <p className="text-base font-semibold text-slate-900">{githubRepository.fullName}</p>
                        <a
                          href={githubRepository.url}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-100"
                        >
                          Open repo
                        </a>
                      </div>
                      {githubRepository.description && (
                        <p className="mt-2 text-sm leading-6 text-slate-600">{githubRepository.description}</p>
                      )}
                      <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-slate-600">
                        <span className="rounded-full bg-white px-3 py-1 ring-1 ring-slate-200">
                          default: {githubRepository.defaultBranch}
                        </span>
                        <span className="rounded-full bg-white px-3 py-1 ring-1 ring-slate-200">
                          {githubPullRequests.length} open PRs loaded
                        </span>
                        <span className="rounded-full bg-white px-3 py-1 ring-1 ring-slate-200">
                          {githubRepository.private ? 'private repo' : 'public repo'}
                        </span>
                      </div>
                    </div>
                  )}

                  {githubPullRequests.length > 0 && (
                    <div className="mt-4 rounded-[28px] border border-slate-200 bg-white p-3">
                      <p className="px-2 pt-2 text-sm font-semibold text-slate-900">Open pull requests</p>
                      <div className="mt-3 max-h-72 space-y-3 overflow-auto px-2 pb-2">
                        {githubPullRequests.map((pullRequest) => (
                          <button
                            key={pullRequest.number}
                            type="button"
                            onClick={() => choosePullRequest(pullRequest)}
                            className={`w-full rounded-3xl border px-4 py-4 text-left transition ${
                              githubUrl === pullRequest.url
                                ? 'border-amber-300 bg-amber-50'
                                : 'border-slate-200 hover:bg-slate-50'
                            }`}
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white">
                                PR #{pullRequest.number}
                              </span>
                              {pullRequest.draft && (
                                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                                  Draft
                                </span>
                              )}
                            </div>
                            <p className="mt-3 text-sm font-semibold text-slate-900">{pullRequest.title}</p>
                            <p className="mt-2 text-xs text-slate-500">
                              by {pullRequest.author} • updated {formatRelativeDate(pullRequest.updatedAt)}
                            </p>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {githubLookupError && (
                    <div className="mt-4 rounded-[28px] bg-rose-50 p-5 text-sm leading-6 text-rose-800">
                      {githubLookupError}
                    </div>
                  )}

                  <label className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">GitHub pull request or file URL</label>
                  <input
                    value={githubUrl}
                    onChange={(event) => {
                      setGitHubUrl(event.target.value);
                      setResult(null);
                      setError(null);
                    }}
                    placeholder={exampleGitHubUrl}
                    className="mt-3 w-full rounded-[28px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-900 outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
                  />
                  <div className="mt-4 rounded-[28px] bg-slate-50 p-5 text-sm leading-7 text-slate-600">
                    Supported formats include GitHub PR URLs like <code className="font-semibold">/pull/123</code>, GitHub file URLs like <code className="font-semibold">/blob/main/src/app.ts</code>, and raw GitHub file URLs.
                  </div>
                </div>
              )}

              <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-slate-500">
                  {inputMode === 'snippet'
                    ? 'Reviews are grounded in static checks first, then upgraded with OpenAI when the backend is configured.'
                    : 'GitHub reviews aggregate findings across the reviewed files and keep a file-by-file breakdown.'}
                </p>

                <button
                  type="button"
                  onClick={inputMode === 'snippet' ? submitReview : submitGitHubReview}
                  disabled={loading || (inputMode === 'snippet' ? !code.trim() : !githubUrl.trim())}
                  className="inline-flex items-center justify-center rounded-3xl bg-amber-400 px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
                >
                  {loading ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-700 border-t-transparent" />
                      Reviewing...
                    </span>
                  ) : (
                    inputMode === 'snippet' ? 'Analyze code' : 'Analyze GitHub target'
                  )}
                </button>
              </div>

              {error && <p className="mt-4 text-sm text-rose-600">{error}</p>}
            </article>

            <aside className="rounded-[32px] border border-slate-200/70 bg-white/90 p-6 shadow-soft backdrop-blur">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-lg font-semibold text-slate-900">Delivery Status</p>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    Backend connectivity, AI mode, and GitHub access live here so you always know what CodeSage can use.
                  </p>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                  Live
                </span>
              </div>

              <div className="mt-6 rounded-[28px] bg-slate-50 p-5">
                <p className="text-sm font-semibold text-slate-700">OpenAI</p>
                <p className="mt-3 text-sm leading-7 text-slate-600">
                  {aiStatus?.aiEnabled
                    ? `Connected with ${aiStatus.model}. Hybrid reviews are active.`
                    : 'Not configured. The local review engine will still return findings and scores.'}
                </p>
              </div>

              <div className="mt-5 space-y-3">
                <div className="rounded-3xl border border-slate-200 px-4 py-4 text-sm leading-6 text-slate-600">
                  <p className="font-semibold text-slate-900">GitHub access</p>
                  <p className="mt-1">
                    {aiStatus?.githubTokenConfigured
                      ? 'GITHUB_TOKEN is configured, so CodeSage can handle private or rate-limited GitHub repos more reliably.'
                      : 'Public GitHub URLs are supported now. Add GITHUB_TOKEN for private repo access and higher rate limits.'}
                  </p>
                </div>
                <div className="rounded-3xl border border-amber-300 bg-amber-50 px-4 py-4 text-sm leading-6 text-slate-900">
                  <p className="font-semibold">{selectedFocus.label}</p>
                  <p className="mt-1">{selectedFocus.caption}</p>
                </div>
              </div>
            </aside>
          </section>

          <section className="grid gap-6 xl:grid-cols-[1.45fr_0.95fr]">
            <article className="rounded-[32px] border border-slate-200/70 bg-white/90 p-6 shadow-soft backdrop-blur">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-lg font-semibold text-slate-900">Review findings</p>
                  <p className="mt-2 text-sm text-slate-500">
                    {result?.context?.kind === 'github-pr'
                      ? 'Top-level findings are merged across the reviewed pull request files.'
                      : 'Findings are ordered by severity, confidence, and your selected review mode.'}
                  </p>
                </div>

                {result && (
                  <div className="flex flex-wrap gap-2">
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${riskStyles[result.riskLevel]}`}>
                      {result.riskLevel} risk
                    </span>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                      {result.suggestions.length} findings
                    </span>
                  </div>
                )}
              </div>

              {!result ? (
                <div className="mt-8 rounded-[28px] border border-dashed border-slate-200 bg-slate-50 p-10 text-center text-sm leading-7 text-slate-500">
                  Run a review to see ranked findings, line references, confidence scores, and a complexity verdict.
                </div>
              ) : (
                <>
                  <div className="mt-6 rounded-[28px] bg-slate-50 p-5">
                    <div className="flex flex-wrap items-center gap-3">
                      <p className="text-sm font-semibold text-slate-700">Summary</p>
                      {result.context?.url && (
                        <a
                          href={result.context.url}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-100"
                        >
                          Open source target
                        </a>
                      )}
                    </div>
                    <p className="mt-3 text-sm leading-7 text-slate-600">{result.summary}</p>
                  </div>

                  <div className="mt-6 space-y-4">
                    {result.suggestions.map((suggestion, index) => (
                      <details
                        key={`${suggestion.title}-${suggestion.line ?? 'na'}`}
                        open={index === 0}
                        className="group rounded-[28px] border border-slate-200 p-5 open:border-slate-300 open:bg-slate-50"
                      >
                        <summary className="cursor-pointer list-none">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${categoryStyles[suggestion.category]}`}>
                                  {suggestion.category}
                                </span>
                                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${severityStyles[suggestion.severity]}`}>
                                  {suggestion.severity}
                                </span>
                                {suggestion.line && (
                                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                                    Line {suggestion.line}
                                  </span>
                                )}
                              </div>
                              <p className="mt-4 text-base font-semibold text-slate-900">{suggestion.title}</p>
                            </div>
                            <div className="flex items-center gap-3 text-xs font-semibold text-slate-500">
                              <span className="rounded-full bg-slate-100 px-3 py-1">
                                {suggestion.confidence}% confidence
                              </span>
                              <span className="rounded-full bg-white px-3 py-1 ring-1 ring-slate-200 transition group-open:bg-slate-900 group-open:text-white">
                                Details
                              </span>
                            </div>
                          </div>
                        </summary>

                        <div className="mt-4 border-t border-slate-200 pt-4">
                          <p className="text-sm leading-7 text-slate-600">{suggestion.detail}</p>
                          {suggestion.fixSuggestion && (
                            <div className="mt-4 rounded-3xl bg-emerald-50 px-4 py-4 text-sm leading-6 text-emerald-900">
                              <p className="font-semibold">Suggested fix</p>
                              <p className="mt-2">{suggestion.fixSuggestion}</p>
                            </div>
                          )}
                        </div>
                      </details>
                    ))}
                  </div>

                  <div className="mt-6 rounded-[28px] bg-slate-950 p-5 text-white">
                    <p className="text-sm font-semibold text-amber-300">Complexity verdict</p>
                    <p className="mt-3 text-sm leading-7 text-slate-200">{result.complexity}</p>
                  </div>
                </>
              )}
            </article>

            <aside className="rounded-[32px] border border-slate-200/70 bg-white/90 p-6 shadow-soft backdrop-blur">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-lg font-semibold text-slate-900">Insights</p>
                  <p className="mt-2 text-sm text-slate-500">
                    Score, source, metrics, and the strongest signals from the latest pass.
                  </p>
                </div>
                {result && (
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                    {sourceLabels[result.source]}
                  </span>
                )}
              </div>

              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <MetricCard label="Language" value={result?.language ?? 'Unknown'} />
                <MetricCard label="Quality Score" value={result ? `${result.qualityScore}/100` : '--'} />
                <MetricCard label="Risk" value={result?.riskLevel ?? 'Not scored'} />
                <MetricCard label="Functions" value={result?.metrics.functionCount ?? '--'} />
              </div>

              <div className="mt-6 rounded-[28px] border border-slate-200 p-5">
                <p className="text-sm font-semibold text-slate-900">Findings by category</p>
                <div className="mt-4 space-y-3">
                  {categoryOrder.map((category) => (
                    <div key={category} className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${categoryStyles[category]}`}>
                          {category}
                        </span>
                      </div>
                      <span className="text-sm font-semibold text-slate-700">{suggestionCounts[category]}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-6 rounded-[28px] border border-slate-200 p-5">
                <p className="text-sm font-semibold text-slate-900">Metrics</p>
                <div className="mt-4 space-y-3 text-sm text-slate-600">
                  <MetricRow label="Non-empty lines" value={result?.metrics.lineCount ?? draftLineCount} />
                  <MetricRow label="Branch points" value={result?.metrics.branchCount ?? '--'} />
                  <MetricRow label="Nesting depth" value={result?.metrics.nestingDepth ?? '--'} />
                  <MetricRow label="Longest line" value={result?.metrics.longestLine ?? '--'} />
                </div>
              </div>

              <div className="mt-6 rounded-[28px] border border-slate-200 p-5">
                <p className="text-sm font-semibold text-slate-900">Score Breakdown</p>
                {result ? (
                  <div className="mt-4 space-y-3">
                    <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
                      <span>Starting score</span>
                      <span className="font-semibold text-slate-900">{result.scoreBreakdown.startingScore}</span>
                    </div>
                    {result.scoreBreakdown.deductions.map((deduction) => (
                      <div key={`${deduction.category}-${deduction.label}`} className="rounded-2xl bg-rose-50 px-4 py-4 text-sm leading-6 text-rose-900">
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-semibold">{deduction.label}</span>
                          <span className="font-semibold">-{deduction.points}</span>
                        </div>
                        <p className="mt-2 text-rose-800">{deduction.reason}</p>
                      </div>
                    ))}
                    <div className="flex items-center justify-between rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                      <span>Final score</span>
                      <span className="font-semibold">{result.scoreBreakdown.finalScore}</span>
                    </div>
                  </div>
                ) : (
                  <p className="mt-4 text-sm leading-6 text-slate-500">Run a review to see where the score deductions come from.</p>
                )}
              </div>

              <div className="mt-6 rounded-[28px] border border-slate-200 p-5">
                <p className="text-sm font-semibold text-slate-900">Strengths</p>
                <div className="mt-4 space-y-3">
                  {(result?.strengths.length ? result.strengths : ['Run a review to capture strengths alongside findings.']).map((item) => (
                    <div key={item} className="rounded-3xl bg-slate-50 px-4 py-4 text-sm leading-6 text-slate-600">
                      {item}
                    </div>
                  ))}
                </div>
              </div>

              <div className={`mt-6 rounded-[28px] p-5 text-sm leading-6 ${aiStatus?.aiEnabled ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-900'}`}>
                {aiStatus?.aiEnabled ? (
                  <>
                    OpenAI is active on the backend with <code className="font-semibold">{aiStatus.model}</code>. Reviews will use hybrid AI analysis plus local checks.
                  </>
                ) : (
                  <>
                    OpenAI is not configured yet. Add <code className="font-semibold">OPENAI_API_KEY</code> to <code className="font-semibold">server/.env</code> and restart the backend to switch from local-only reviews to hybrid AI reviews.
                  </>
                  )}
              </div>

              <div className="mt-6 rounded-[28px] border border-slate-200 p-5">
                <p className="text-sm font-semibold text-slate-900">PR Review Comments</p>
                {result ? (
                  <div className="mt-4 space-y-3">
                    {result.reviewComments.map((comment) => (
                      <div key={comment.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-6 text-slate-700">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${severityStyles[comment.severity]}`}>
                            {comment.severity}
                          </span>
                          {comment.path && (
                            <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
                              {comment.path}
                            </span>
                          )}
                          {comment.line && (
                            <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
                              Line {comment.line}
                            </span>
                          )}
                        </div>
                        <p className="mt-3 text-sm text-slate-800">{comment.body}</p>
                        {comment.fixSuggestion && (
                          <div className="mt-3 rounded-2xl bg-emerald-50 px-4 py-3 text-emerald-900">
                            <span className="font-semibold">Suggested fix:</span> {comment.fixSuggestion}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-4 text-sm leading-6 text-slate-500">Run a review to simulate GitHub-style inline comments.</p>
                )}
              </div>
              {statusError && (
                <div className="mt-4 rounded-[28px] bg-rose-50 p-5 text-sm leading-6 text-rose-800">
                  {statusError}
                </div>
              )}
            </aside>
          </section>

          {result && hasImprovedCode && (
            <section className="rounded-[32px] border border-slate-200/70 bg-white/90 p-6 shadow-soft backdrop-blur">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-lg font-semibold text-slate-900">Before vs After</p>
                  <p className="mt-2 text-sm text-slate-500">
                    CodeSage generated a quick-fix preview from the detected issues so you can compare the current code against a safer draft.
                  </p>
                </div>
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-900">
                  Fix preview
                </span>
              </div>

              <div className="mt-6 grid gap-6 xl:grid-cols-2">
                <CodePane title="Original code" code={result.originalCode ?? ''} tone="slate" />
                <CodePane title="Suggested improved code" code={result.improvedCode ?? ''} tone="emerald" />
              </div>
            </section>
          )}

          {result?.files && result.files.length > 0 && (
            <section className="rounded-[32px] border border-slate-200/70 bg-white/90 p-6 shadow-soft backdrop-blur">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-lg font-semibold text-slate-900">File Breakdown</p>
                  <p className="mt-2 text-sm text-slate-500">
                    {result.context?.kind === 'github-pr'
                      ? 'Each reviewed file keeps its own score, summary, and findings.'
                      : 'The source target is also shown as a file-level breakdown.'}
                  </p>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                  {result.files.length} file{result.files.length === 1 ? '' : 's'}
                </span>
              </div>

              <div className="mt-6 space-y-4">
                {result.files.map((file, index) => (
                  <FileReviewCard key={`${file.filename}-${index}`} file={file} />
                ))}
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-[24px] bg-slate-50 p-4">
      <p className="text-xs uppercase tracking-[0.24em] text-slate-500">{label}</p>
      <p className="mt-3 text-2xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between">
      <span>{label}</span>
      <span className="font-semibold text-slate-900">{value}</span>
    </div>
  );
}

function CodePane({ title, code, tone }: { title: string; code: string; tone: 'slate' | 'emerald' }) {
  const toneClasses = tone === 'emerald'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
    : 'border-slate-200 bg-slate-50 text-slate-900';

  return (
    <div className={`rounded-[28px] border p-5 ${toneClasses}`}>
      <p className="text-sm font-semibold">{title}</p>
      <pre className="mt-4 overflow-auto whitespace-pre-wrap break-words rounded-2xl bg-white/70 p-4 text-xs leading-6">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function formatRelativeDate(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return value;
  }

  const diffInHours = Math.max(1, Math.round((Date.now() - timestamp) / (1000 * 60 * 60)));
  if (diffInHours < 24) {
    return `${diffInHours}h ago`;
  }

  const diffInDays = Math.round(diffInHours / 24);
  return `${diffInDays}d ago`;
}

function FileReviewCard({ file }: { file: ReviewedFile }) {
  const hasImprovedCode =
    Boolean(file.review.originalCode && file.review.improvedCode) &&
    file.review.originalCode?.trim() !== file.review.improvedCode?.trim();

  return (
    <details className="group rounded-[28px] border border-slate-200 p-5 open:border-slate-300 open:bg-slate-50">
      <summary className="cursor-pointer list-none">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white">
                {file.status}
              </span>
              {typeof file.changes === 'number' && (
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                  {file.changes} changes
                </span>
              )}
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                {file.review.suggestions.length} findings
              </span>
            </div>
            <p className="mt-4 text-base font-semibold text-slate-900">{file.filename}</p>
            <p className="mt-2 text-sm leading-6 text-slate-600">{file.review.summary}</p>
          </div>

          <div className="flex items-center gap-3 text-xs font-semibold text-slate-500">
            <span className="rounded-full bg-slate-100 px-3 py-1">{file.review.qualityScore}/100</span>
            <span className="rounded-full bg-white px-3 py-1 ring-1 ring-slate-200 transition group-open:bg-slate-900 group-open:text-white">
              Details
            </span>
          </div>
        </div>
      </summary>

      <div className="mt-4 border-t border-slate-200 pt-4">
        <div className="flex flex-wrap gap-2">
          {file.url && (
            <a
              href={file.url}
              target="_blank"
              rel="noreferrer"
              className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-100"
            >
              Open file
            </a>
          )}
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
            {file.review.language}
          </span>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
            {file.review.riskLevel} risk
          </span>
        </div>

        <div className="mt-4 space-y-3">
          {file.review.suggestions.map((suggestion) => (
            <div key={`${file.filename}-${suggestion.title}-${suggestion.line ?? 'na'}`} className="rounded-3xl bg-white px-4 py-4 ring-1 ring-slate-200">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${categoryStyles[suggestion.category]}`}>
                  {suggestion.category}
                </span>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${severityStyles[suggestion.severity]}`}>
                  {suggestion.severity}
                </span>
                {suggestion.line && (
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                    Line {suggestion.line}
                  </span>
                )}
              </div>
              <p className="mt-3 text-sm font-semibold text-slate-900">{suggestion.title}</p>
              <p className="mt-2 text-sm leading-6 text-slate-600">{suggestion.detail}</p>
              {suggestion.fixSuggestion && (
                <div className="mt-3 rounded-2xl bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-900">
                  <span className="font-semibold">Suggested fix:</span> {suggestion.fixSuggestion}
                </div>
              )}
            </div>
          ))}
        </div>

        {hasImprovedCode && (
          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <CodePane title="Original file" code={file.review.originalCode ?? ''} tone="slate" />
            <CodePane title="Suggested improved file" code={file.review.improvedCode ?? ''} tone="emerald" />
          </div>
        )}
      </div>
    </details>
  );
}

export default CodeReviewDashboard;
