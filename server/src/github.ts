import { analyzeCode, type ReviewContext, type ReviewFocus, type ReviewResponse, type ReviewedFile, type ReviewSuggestion } from './openai.js';

const githubToken = process.env.GITHUB_TOKEN;
const maxReviewableFiles = 6;
const maxFileContentLength = 18_000;

interface AnalyzeGitHubInput {
  url: string;
  focus?: ReviewFocus;
}

export interface GitHubRepositorySummary {
  owner: string;
  repo: string;
  fullName: string;
  description: string | null;
  defaultBranch: string;
  url: string;
  private: boolean;
  openPullRequests: number;
}

export interface GitHubPullRequestSummary {
  number: number;
  title: string;
  url: string;
  state: 'open' | 'closed';
  draft: boolean;
  updatedAt: string;
  author: string;
  additions?: number;
  deletions?: number;
  changedFiles?: number;
}

interface PullRequestFile {
  filename: string;
  status: 'added' | 'modified' | 'removed' | 'renamed';
  additions: number;
  deletions: number;
  changes: number;
  blob_url?: string;
  contents_url?: string;
  patch?: string;
}

type ParsedGitHubTarget =
  | {
      kind: 'github-pr';
      owner: string;
      repo: string;
      pullNumber: number;
      url: string;
    }
  | {
      kind: 'github-file';
      owner: string;
      repo: string;
      ref: string;
      path: string;
      url: string;
    };

interface ParsedRepositoryTarget {
  owner: string;
  repo: string;
  url: string;
}

export async function analyzeGitHubUrl({
  url,
  focus = 'full',
}: AnalyzeGitHubInput): Promise<ReviewResponse> {
  const parsed = parseGitHubUrl(url);

  if (parsed.kind === 'github-pr') {
    return analyzePullRequest(parsed, focus);
  }

  return analyzeGitHubFile(parsed, focus);
}

export async function getGitHubRepositorySummary(input: string): Promise<GitHubRepositorySummary> {
  const target = parseRepositoryInput(input);
  const repository = await fetchGitHubJson<{
    owner: { login: string };
    name: string;
    full_name: string;
    description: string | null;
    default_branch: string;
    html_url: string;
    private: boolean;
    open_issues_count: number;
  }>(`https://api.github.com/repos/${target.owner}/${target.repo}`);

  const pulls = await fetchGitHubJson<Array<{ id: number }>>(
    `https://api.github.com/repos/${target.owner}/${target.repo}/pulls?state=open&per_page=100`,
  );

  return {
    owner: repository.owner.login,
    repo: repository.name,
    fullName: repository.full_name,
    description: repository.description,
    defaultBranch: repository.default_branch,
    url: repository.html_url,
    private: repository.private,
    openPullRequests: pulls.length,
  };
}

export async function listGitHubPullRequests(input: string): Promise<GitHubPullRequestSummary[]> {
  const target = parseRepositoryInput(input);
  const pulls = await fetchGitHubJson<Array<{
    number: number;
    title: string;
    html_url: string;
    state: 'open' | 'closed';
    draft: boolean;
    updated_at: string;
    user: { login: string };
    additions: number;
    deletions: number;
    changed_files: number;
  }>>(
    `https://api.github.com/repos/${target.owner}/${target.repo}/pulls?state=open&sort=updated&direction=desc&per_page=15`,
  );

  return pulls.map((pull) => ({
    number: pull.number,
    title: pull.title,
    url: pull.html_url,
    state: pull.state,
    draft: pull.draft,
    updatedAt: pull.updated_at,
    author: pull.user.login,
    additions: pull.additions,
    deletions: pull.deletions,
    changedFiles: pull.changed_files,
  }));
}

function parseGitHubUrl(input: string): ParsedGitHubTarget {
  let url: URL;

  try {
    url = new URL(input);
  } catch {
    throw new Error('Enter a valid GitHub pull request or file URL.');
  }

  if (url.hostname === 'raw.githubusercontent.com') {
    const [owner, repo, ref, ...pathParts] = splitPath(url.pathname);
    if (!owner || !repo || !ref || pathParts.length === 0) {
      throw new Error('GitHub raw file URL is missing owner, repo, ref, or file path.');
    }

    return {
      kind: 'github-file',
      owner,
      repo: stripGitSuffix(repo),
      ref,
      path: pathParts.join('/'),
      url: input,
    };
  }

  if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') {
    throw new Error('Only GitHub URLs are supported right now.');
  }

  const [owner, repo, resource, identifier, ...rest] = splitPath(url.pathname);
  if (!owner || !repo || !resource || !identifier) {
    throw new Error('GitHub URL format is not supported. Use a PR URL or a file URL.');
  }

  const normalizedRepo = stripGitSuffix(repo);

  if (resource === 'pull' && /^\d+$/.test(identifier)) {
    return {
      kind: 'github-pr',
      owner,
      repo: normalizedRepo,
      pullNumber: Number(identifier),
      url: input,
    };
  }

  if ((resource === 'blob' || resource === 'raw') && rest.length > 0) {
    return {
      kind: 'github-file',
      owner,
      repo: normalizedRepo,
      ref: identifier,
      path: rest.join('/'),
      url: input,
    };
  }

  throw new Error('Use a GitHub pull request URL or a direct file URL for review.');
}

function parseRepositoryInput(input: string): ParsedRepositoryTarget {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('Repository is required. Use a value like owner/repo or a GitHub repo URL.');
  }

  const shorthandMatch = trimmed.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (shorthandMatch) {
    const owner = shorthandMatch[1];
    const repo = stripGitSuffix(shorthandMatch[2]);

    return {
      owner,
      repo,
      url: `https://github.com/${owner}/${repo}`,
    };
  }

  let url: URL;

  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('Use a repository in the form owner/repo or a GitHub repository URL.');
  }

  if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') {
    throw new Error('Only GitHub repositories are supported right now.');
  }

  const [owner, repo] = splitPath(url.pathname);
  if (!owner || !repo) {
    throw new Error('GitHub repository URL is missing owner or repo.');
  }

  return {
    owner,
    repo: stripGitSuffix(repo),
    url: `https://github.com/${owner}/${stripGitSuffix(repo)}`,
  };
}

async function analyzeGitHubFile(
  target: Extract<ParsedGitHubTarget, { kind: 'github-file' }>,
  focus: ReviewFocus,
): Promise<ReviewResponse> {
  const code = await fetchRepositoryFile(target.owner, target.repo, target.path, target.ref);
  const review = await analyzeCode({
    code,
    filename: target.path.split('/').pop() || target.path,
    focus,
  });

  return {
    ...review,
    context: {
      kind: 'github-file',
      label: `${target.owner}/${target.repo}/${target.path}`,
      url: target.url,
      repository: `${target.owner}/${target.repo}`,
    },
    files: [
      {
        filename: target.path,
        status: 'modified',
        url: target.url,
        review: reviewWithoutNestedContext(review),
      },
    ],
  };
}

async function analyzePullRequest(
  target: Extract<ParsedGitHubTarget, { kind: 'github-pr' }>,
  focus: ReviewFocus,
): Promise<ReviewResponse> {
  const repository = `${target.owner}/${target.repo}`;
  const [pullRequest, files] = await Promise.all([
    fetchGitHubJson<{ title: string }>(
      `https://api.github.com/repos/${target.owner}/${target.repo}/pulls/${target.pullNumber}`,
    ),
    fetchPullRequestFiles(target.owner, target.repo, target.pullNumber),
  ]);

  const reviewableFiles = files
    .filter((file) => file.status !== 'removed')
    .sort((left, right) => right.changes - left.changes)
    .slice(0, maxReviewableFiles);

  const reviewedFiles: ReviewedFile[] = [];

  for (const file of reviewableFiles) {
    const code = await resolvePullRequestFileContent(target.owner, target.repo, file);
    if (!code || !code.trim()) {
      continue;
    }

    const review = await analyzeCode({
      code,
      filename: file.filename,
      focus,
    });

    reviewedFiles.push({
      filename: file.filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      changes: file.changes,
      url: file.blob_url,
      review: reviewWithoutNestedContext(review),
    });
  }

  const context: ReviewContext = {
    kind: 'github-pr',
    label: `${repository} PR #${target.pullNumber}`,
    url: target.url,
    repository,
    pullRequestNumber: target.pullNumber,
  };

  if (reviewedFiles.length === 0) {
    return createNoReviewableFilesResponse(context, pullRequest.title || `${repository} PR #${target.pullNumber}`);
  }

  return aggregateGitHubReviews(
    reviewedFiles,
    context,
    pullRequest.title || `${repository} PR #${target.pullNumber}`,
  );
}

async function fetchPullRequestFiles(owner: string, repo: string, pullNumber: number): Promise<PullRequestFile[]> {
  const files: PullRequestFile[] = [];

  for (let page = 1; page <= 3; page += 1) {
    const batch = await fetchGitHubJson<PullRequestFile[]>(
      `https://api.github.com/repos/${owner}/${repo}/pulls/${pullNumber}/files?per_page=100&page=${page}`,
    );

    files.push(...batch);

    if (batch.length < 100) {
      break;
    }
  }

  return files;
}

async function resolvePullRequestFileContent(owner: string, repo: string, file: PullRequestFile): Promise<string | null> {
  if (file.contents_url) {
    try {
      return await fetchGitHubText(file.contents_url, 'application/vnd.github.raw');
    } catch {
      // Fall through to patch-based review below.
    }
  }

  if (file.patch) {
    return file.patch;
  }

  if (file.blob_url) {
    const parsed = parseGitHubUrl(file.blob_url);
    if (parsed.kind === 'github-file') {
      return fetchRepositoryFile(owner, repo, parsed.path, parsed.ref);
    }
  }

  return null;
}

async function fetchRepositoryFile(owner: string, repo: string, path: string, ref: string): Promise<string> {
  const encodedPath = path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');

  const responseText = await fetchGitHubText(
    `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`,
    'application/vnd.github.raw',
  );

  return trimTextForReview(responseText);
}

function aggregateGitHubReviews(
  files: ReviewedFile[],
  context: ReviewContext,
  pullTitle: string,
): ReviewResponse {
  const combinedSuggestions = files.flatMap((file) =>
    file.review.suggestions.map((suggestion) => ({
      ...suggestion,
      title: `${suggestion.title} (${file.filename.split('/').pop() || file.filename})`,
      detail: `${file.filename}${suggestion.line ? `:${suggestion.line}` : ''} - ${suggestion.detail}`,
    })),
  );

  const prioritizedSuggestions = prioritizeSuggestions(combinedSuggestions).slice(0, 12);
  const totalMetrics = files.reduce(
    (accumulator, file) => ({
      lineCount: accumulator.lineCount + file.review.metrics.lineCount,
      functionCount: accumulator.functionCount + file.review.metrics.functionCount,
      branchCount: accumulator.branchCount + file.review.metrics.branchCount,
      nestingDepth: Math.max(accumulator.nestingDepth, file.review.metrics.nestingDepth),
      longestLine: Math.max(accumulator.longestLine, file.review.metrics.longestLine),
      suggestionCount: accumulator.suggestionCount + file.review.metrics.suggestionCount,
    }),
    {
      lineCount: 0,
      functionCount: 0,
      branchCount: 0,
      nestingDepth: 0,
      longestLine: 0,
      suggestionCount: 0,
    },
  );

  const source = files.some((file) => file.review.source === 'hybrid') ? 'hybrid' : 'heuristic';
  const qualityScore = Math.round(
    files.reduce((total, file) => total + file.review.qualityScore, 0) / files.length,
  );
  const riskLevel = highestRiskLevel(files.map((file) => file.review.riskLevel));
  const strengths = [...new Set(files.flatMap((file) => file.review.strengths))].slice(0, 5);
  const languages = [...new Set(files.map((file) => file.review.language))];
  const reviewComments = files.flatMap((file) =>
    file.review.suggestions.map((suggestion, index) => ({
      id: `${file.filename}-${suggestion.line ?? 'na'}-${index}`,
      line: suggestion.line,
      severity: suggestion.severity,
      body: `${suggestion.title}: ${suggestion.detail}`,
      fixSuggestion: suggestion.fixSuggestion,
      path: file.filename,
    })),
  );
  const scoreBreakdown = buildAggregateScoreBreakdown(files, qualityScore);

  return {
    summary: `Reviewed ${files.length} GitHub file${files.length === 1 ? '' : 's'} from ${context.label}. Overall risk is ${riskLevel.toLowerCase()}, with ${prioritizedSuggestions.length} prioritized finding${prioritizedSuggestions.length === 1 ? '' : 's'} across the changed code.`,
    suggestions: prioritizedSuggestions,
    complexity: `${pullTitle}: ${totalMetrics.functionCount} function-like blocks, ${totalMetrics.branchCount} branch points, and maximum nesting depth ${totalMetrics.nestingDepth} across the reviewed files.`,
    language: languages.length === 1 ? languages[0] : 'Mixed',
    qualityScore,
    scoreBreakdown,
    riskLevel,
    strengths,
    metrics: {
      ...totalMetrics,
      suggestionCount: prioritizedSuggestions.length,
    },
    source,
    reviewComments,
    context,
    files,
  };
}

function createNoReviewableFilesResponse(context: ReviewContext, pullTitle: string): ReviewResponse {
  return {
    summary: `CodeSage could not extract reviewable text content from ${context.label}. The pull request may only contain deleted, binary, or unsupported files.`,
    suggestions: [
      {
        category: 'Improvement',
        severity: 'Low',
        title: 'No reviewable text diff was available',
        detail: 'Try reviewing a file URL directly, or make sure the pull request contains text files with accessible contents.',
        line: null,
        confidence: 70,
        fixSuggestion: 'Use a GitHub file URL or a pull request that includes text-based source changes.',
      },
    ],
    complexity: `${pullTitle}: no text-based files were available for static analysis.`,
    language: 'Mixed',
    qualityScore: 60,
    scoreBreakdown: {
      startingScore: 100,
      deductions: [
        {
          category: 'Maintainability',
          label: 'Maintainability',
          points: 40,
          reason: 'No reviewable text content was available for analysis.',
        },
      ],
      finalScore: 60,
    },
    riskLevel: 'Low',
    strengths: ['The GitHub target was parsed successfully, so CodeSage is ready once reviewable source files are available.'],
    metrics: {
      lineCount: 0,
      functionCount: 0,
      branchCount: 0,
      nestingDepth: 0,
      longestLine: 0,
      suggestionCount: 1,
    },
    source: 'heuristic',
    reviewComments: [
      {
        id: `${context.label}-no-reviewable-files`,
        line: null,
        severity: 'Low',
        body: 'No reviewable text diff was available for this GitHub target.',
        fixSuggestion: 'Use a GitHub file URL or a pull request that contains text-based code changes.',
      },
    ],
    context,
    files: [],
  };
}

function buildAggregateScoreBreakdown(files: ReviewedFile[], finalScore: number): ReviewResponse['scoreBreakdown'] {
  const grouped = new Map<string, ReviewResponse['scoreBreakdown']['deductions'][number]>();

  for (const file of files) {
    for (const deduction of file.review.scoreBreakdown.deductions) {
      const key = deduction.category;
      const existing = grouped.get(key);
      if (existing) {
        existing.points += deduction.points;
        existing.reason = `${existing.reason}; ${file.filename}`;
      } else {
        grouped.set(key, {
          category: deduction.category,
          label: deduction.label,
          points: deduction.points,
          reason: file.filename,
        });
      }
    }
  }

  return {
    startingScore: 100,
    deductions: [...grouped.values()].sort((left, right) => right.points - left.points),
    finalScore,
  };
}

function reviewWithoutNestedContext(review: ReviewResponse): ReviewResponse {
  return {
    ...review,
    context: undefined,
    files: undefined,
  };
}

function prioritizeSuggestions(suggestions: ReviewSuggestion[]): ReviewSuggestion[] {
  const severityOrder: Record<ReviewSuggestion['severity'], number> = {
    Critical: 4,
    High: 3,
    Medium: 2,
    Low: 1,
  };

  const categoryOrder: Record<ReviewSuggestion['category'], number> = {
    Bug: 5,
    Security: 4,
    Complexity: 3,
    Improvement: 2,
    Style: 1,
  };

  return [...suggestions]
    .sort((left, right) => {
      const severityDelta = severityOrder[right.severity] - severityOrder[left.severity];
      if (severityDelta !== 0) {
        return severityDelta;
      }

      const categoryDelta = categoryOrder[right.category] - categoryOrder[left.category];
      if (categoryDelta !== 0) {
        return categoryDelta;
      }

      const confidenceDelta = right.confidence - left.confidence;
      if (confidenceDelta !== 0) {
        return confidenceDelta;
      }

      return (left.line ?? 99999) - (right.line ?? 99999);
    })
    .filter((suggestion, index, items) => {
      const key = `${suggestion.title.toLowerCase()}:${suggestion.line ?? 'na'}`;
      return items.findIndex((item) => `${item.title.toLowerCase()}:${item.line ?? 'na'}` === key) === index;
    });
}

function highestRiskLevel(levels: ReviewResponse['riskLevel'][]): ReviewResponse['riskLevel'] {
  const order: Record<ReviewResponse['riskLevel'], number> = {
    Low: 0,
    Medium: 1,
    High: 2,
    Critical: 3,
  };

  return [...levels].sort((left, right) => order[right] - order[left])[0] ?? 'Low';
}

async function fetchGitHubJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: buildGitHubHeaders('application/vnd.github+json'),
  });

  if (!response.ok) {
    throw new Error(await buildGitHubError(response));
  }

  return (await response.json()) as T;
}

async function fetchGitHubText(url: string, accept: string): Promise<string> {
  const response = await fetch(url, {
    headers: buildGitHubHeaders(accept),
  });

  if (!response.ok) {
    throw new Error(await buildGitHubError(response));
  }

  return trimTextForReview(await response.text());
}

function buildGitHubHeaders(accept: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: accept,
    'User-Agent': 'CodeSage-Reviewer',
  };

  if (githubToken) {
    headers.Authorization = `Bearer ${githubToken}`;
  }

  return headers;
}

async function buildGitHubError(response: Response): Promise<string> {
  const defaultMessage = response.status === 404
    ? 'GitHub resource was not found. Make sure the URL is public or configure GITHUB_TOKEN for private repos.'
    : response.status === 403
      ? 'GitHub API rate limit or permission error. Set GITHUB_TOKEN to increase API access.'
      : 'GitHub fetch failed.';

  try {
    const payload = (await response.json()) as { message?: string };
    return payload.message ? `GitHub fetch failed: ${payload.message}` : defaultMessage;
  } catch {
    return defaultMessage;
  }
}

function trimTextForReview(value: string): string {
  return value.length > maxFileContentLength ? value.slice(0, maxFileContentLength) : value;
}

function splitPath(pathname: string): string[] {
  return pathname.split('/').filter(Boolean);
}

function stripGitSuffix(value: string): string {
  return value.replace(/\.git$/i, '');
}
