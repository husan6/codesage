import OpenAI from 'openai';

const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL || 'gpt-5.2';
const client = apiKey ? new OpenAI({ apiKey }) : null;

const reviewCategories = ['Bug', 'Improvement', 'Complexity', 'Security', 'Style'] as const;
const severities = ['Critical', 'High', 'Medium', 'Low'] as const;
const riskLevels = ['Low', 'Medium', 'High', 'Critical'] as const;
const reviewSources = ['heuristic', 'hybrid'] as const;
const reviewFocuses = ['full', 'security', 'quality', 'performance'] as const;

type ReviewCategory = (typeof reviewCategories)[number];
type ReviewSeverity = (typeof severities)[number];
type RiskLevel = (typeof riskLevels)[number];
type ReviewSource = (typeof reviewSources)[number];
export type ReviewFocus = (typeof reviewFocuses)[number];

export interface ReviewContext {
  kind: 'snippet' | 'github-file' | 'github-pr';
  label: string;
  url?: string;
  repository?: string;
  pullRequestNumber?: number;
}

export interface ReviewSuggestion {
  category: ReviewCategory;
  severity: ReviewSeverity;
  title: string;
  detail: string;
  line: number | null;
  confidence: number;
  fixSuggestion?: string;
}

export interface ReviewMetrics {
  lineCount: number;
  functionCount: number;
  branchCount: number;
  nestingDepth: number;
  longestLine: number;
  suggestionCount: number;
}

export interface ScoreDeduction {
  category: ReviewCategory | 'Maintainability';
  label: string;
  points: number;
  reason: string;
}

export interface ScoreBreakdown {
  startingScore: number;
  deductions: ScoreDeduction[];
  finalScore: number;
}

export interface ReviewComment {
  id: string;
  line: number | null;
  severity: ReviewSeverity;
  body: string;
  fixSuggestion?: string;
  path?: string;
}

export interface ReviewedFile {
  filename: string;
  status: 'added' | 'modified' | 'removed' | 'renamed' | 'unknown';
  additions?: number;
  deletions?: number;
  changes?: number;
  url?: string;
  review: ReviewResponse;
}

export interface ReviewResponse {
  summary: string;
  suggestions: ReviewSuggestion[];
  complexity: string;
  language: string;
  qualityScore: number;
  scoreBreakdown: ScoreBreakdown;
  riskLevel: RiskLevel;
  strengths: string[];
  metrics: ReviewMetrics;
  source: ReviewSource;
  reviewComments: ReviewComment[];
  originalCode?: string;
  improvedCode?: string;
  context?: ReviewContext;
  files?: ReviewedFile[];
}

export interface AnalyzeCodeInput {
  code: string;
  filename?: string;
  focus?: ReviewFocus;
}

const reviewSchema = {
  type: 'json_schema',
  name: 'codesage_review',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'complexity', 'language', 'qualityScore', 'riskLevel', 'strengths', 'suggestions'],
    properties: {
      summary: { type: 'string' },
      complexity: { type: 'string' },
      language: { type: 'string' },
      qualityScore: { type: 'integer', minimum: 0, maximum: 100 },
      riskLevel: { type: 'string', enum: [...riskLevels] },
      strengths: {
        type: 'array',
        items: { type: 'string' },
      },
      suggestions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
            required: ['category', 'severity', 'title', 'detail', 'line', 'confidence', 'fixSuggestion'],
            properties: {
              category: { type: 'string', enum: [...reviewCategories] },
              severity: { type: 'string', enum: [...severities] },
              title: { type: 'string' },
              detail: { type: 'string' },
            line: {
              anyOf: [
                { type: 'integer', minimum: 1 },
                { type: 'null' },
              ],
              },
              confidence: { type: 'integer', minimum: 0, maximum: 100 },
              fixSuggestion: { type: 'string' },
            },
          },
        },
      },
  },
} as const;

const severityWeights: Record<ReviewSeverity, number> = {
  Critical: 24,
  High: 16,
  Medium: 10,
  Low: 4,
};

const riskWeights: Record<RiskLevel, number> = {
  Low: 0,
  Medium: 1,
  High: 2,
  Critical: 3,
};

export async function analyzeCode({
  code,
  filename,
  focus = 'full',
}: AnalyzeCodeInput): Promise<ReviewResponse> {
  const heuristicReview = analyzeCodeHeuristically(code, filename, focus);

  if (!client) {
    return heuristicReview;
  }

  try {
    const aiReview = await analyzeWithOpenAI(code, filename, focus, heuristicReview);
    if (!aiReview) {
      return heuristicReview;
    }

    return mergeReviews(aiReview, heuristicReview, focus);
  } catch (error) {
    console.error('OpenAI review failed, falling back to heuristic analysis.', error);
    return heuristicReview;
  }
}

async function analyzeWithOpenAI(
  code: string,
  filename: string | undefined,
  focus: ReviewFocus,
  heuristicReview: ReviewResponse,
): Promise<ReviewResponse | null> {
  if (!client) {
    return null;
  }

  const prompt = [
    'You are CodeSage, a premium AI code reviewer.',
    'Return JSON only.',
    `Review focus: ${focus}.`,
    'Prioritize concrete findings, real bug risk, maintainability, security, and developer trust.',
    'Avoid filler and avoid praising code unless it is a genuine strength.',
    'Use the supplied schema and keep findings actionable.',
    '',
    `Filename: ${filename || 'snippet'}`,
    `Language guess: ${heuristicReview.language}`,
    'Deterministic metrics from the local review engine:',
    JSON.stringify(heuristicReview.metrics),
    '',
    'Code:',
    code,
  ].join('\n');

  const response = await client.responses.create({
    model,
    input: prompt,
    text: {
      format: reviewSchema,
    },
  });

  const outputText = response.output_text?.trim();
  if (!outputText) {
    return null;
  }

  const parsed = safeJsonParse(outputText);
  if (!parsed || !isRecord(parsed)) {
    return null;
  }

  return normalizeAiReview(parsed, heuristicReview.metrics);
}

function normalizeAiReview(raw: Record<string, unknown>, metrics: ReviewMetrics): ReviewResponse | null {
  const suggestions = normalizeSuggestions(raw.suggestions);
  const summary = asTrimmedString(raw.summary);
  const complexity = asTrimmedString(raw.complexity);
  const language = asTrimmedString(raw.language);
  const scoreBreakdown = buildScoreBreakdown(suggestions, metrics);
  const qualityScore = clamp(asInteger(raw.qualityScore) ?? scoreBreakdown.finalScore, 0, 100);
  const riskLevel = normalizeRiskLevel(raw.riskLevel) ?? deriveRiskLevelFromSuggestions(suggestions);
  const strengths = normalizeStrengths(raw.strengths);

  if (!summary || !complexity || !language) {
    return null;
  }

  return {
    summary,
    complexity,
    language,
    qualityScore,
    scoreBreakdown: {
      ...scoreBreakdown,
      finalScore: qualityScore,
    },
    riskLevel,
    strengths,
    suggestions,
    metrics: {
      ...metrics,
      suggestionCount: suggestions.length,
    },
    source: 'hybrid',
    reviewComments: buildReviewComments(suggestions),
  };
}

function analyzeCodeHeuristically(
  code: string,
  filename: string | undefined,
  focus: ReviewFocus,
): ReviewResponse {
  const lines = code.split(/\r?\n/);
  const language = detectLanguage(code, filename);
  const metrics = collectMetrics(lines, code);
  const suggestions: ReviewSuggestion[] = [];

  const pushSuggestion = (suggestion: ReviewSuggestion) => {
    const duplicate = suggestions.some(
      (item) =>
        item.category === suggestion.category &&
        item.title.toLowerCase() === suggestion.title.toLowerCase() &&
        item.line === suggestion.line,
    );

    if (!duplicate) {
      suggestions.push(suggestion);
    }
  };

  const addLineSuggestion = (
    predicate: (line: string) => boolean,
    suggestion: Omit<ReviewSuggestion, 'line'>,
  ) => {
    const line = findMatchingLine(lines, predicate);
    if (line) {
      pushSuggestion({ ...suggestion, line });
    }
  };

  addLineSuggestion(
    (line) => line.includes('<=') && line.includes('.length'),
    {
      category: 'Bug',
      severity: 'High',
      title: 'Possible off-by-one array access',
      detail: 'Loop bounds use `<= array.length`, which can read one item past the end and produce `undefined` values.',
      confidence: 94,
      fixSuggestion: 'Change the loop condition to use `< array.length` so the final iteration does not read past the array boundary.',
    },
  );

  addLineSuggestion(
    (line) => hasLooseEquality(line),
    {
      category: 'Bug',
      severity: 'Medium',
      title: 'Loose equality can hide edge cases',
      detail: 'Prefer strict equality checks so coercion does not change control flow for unexpected inputs.',
      confidence: 86,
      fixSuggestion: 'Replace `==` or `!=` with `===` or `!==` so type coercion does not mask invalid inputs.',
    },
  );

  addLineSuggestion(
    (line) => /\beval\s*\(|\bnew Function\s*\(/.test(line),
    {
      category: 'Security',
      severity: 'Critical',
      title: 'Dynamic code execution detected',
      detail: 'Executing strings as code is a high-risk security pattern. Replace it with explicit parsing or vetted command dispatch.',
      confidence: 98,
      fixSuggestion: 'Remove `eval` or `new Function` and route the logic through explicit parsing or a safe lookup table.',
    },
  );

  addLineSuggestion(
    (line) => /\.innerHTML\s*=/.test(line),
    {
      category: 'Security',
      severity: 'High',
      title: 'Unsafe HTML injection path',
      detail: 'Assigning directly to `innerHTML` can open an XSS path if the value is ever user-controlled. Prefer safe DOM APIs or sanitization.',
      confidence: 95,
      fixSuggestion: 'Prefer `textContent` for plain text output, or sanitize HTML before writing to the DOM.',
    },
  );

  addLineSuggestion(
    (line) => /(api[_-]?key|secret|token|password)\s*[:=]\s*['"`][^'"`\n]{8,}/i.test(line),
    {
      category: 'Security',
      severity: 'Critical',
      title: 'Possible hardcoded secret',
      detail: 'Sensitive credentials should come from environment variables or a secret manager, not source code.',
      confidence: 97,
      fixSuggestion: 'Move the credential to an environment variable or secret manager and read it at runtime.',
    },
  );

  addLineSuggestion(
    (line) => /\b(select|insert|update|delete)\b/i.test(line) && line.includes('+'),
    {
      category: 'Security',
      severity: 'High',
      title: 'SQL query built via string concatenation',
      detail: 'Concatenated SQL can introduce injection risk. Use parameterized queries or prepared statements instead.',
      confidence: 91,
      fixSuggestion: 'Switch to parameterized queries or prepared statements so user input is never concatenated into SQL text.',
    },
  );

  addLineSuggestion(
    (line) => /\bconsole\.(log|debug|info)\s*\(/.test(line),
    {
      category: 'Style',
      severity: 'Low',
      title: 'Debug logging left in source',
      detail: 'Remove ad hoc logging before shipping or replace it with structured logging behind an environment-aware logger.',
      confidence: 74,
      fixSuggestion: 'Remove the debug log or gate it behind a structured logger that can be disabled outside development.',
    },
  );

  addLineSuggestion(
    (line) => /\bvar\s+[A-Za-z_$]/.test(line),
    {
      category: 'Style',
      severity: 'Low',
      title: 'Legacy `var` declaration',
      detail: 'Prefer `const` or `let` so scope is easier to reason about and accidental reassignments are less likely.',
      confidence: 78,
      fixSuggestion: 'Replace `var` with `let` or `const`, depending on whether the variable is reassigned.',
    },
  );

  addLineSuggestion(
    (line) => /:\s*any\b|<any>/.test(line),
    {
      category: 'Improvement',
      severity: 'Low',
      title: 'Type safety weakened by `any`',
      detail: 'Replace `any` with a real domain type or a narrower generic to keep static analysis useful.',
      confidence: 80,
      fixSuggestion: 'Replace `any` with a concrete interface or a narrower generic that describes the real data shape.',
    },
  );

  addLineSuggestion(
    (line) => /\b(TODO|FIXME)\b/.test(line),
    {
      category: 'Improvement',
      severity: 'Low',
      title: 'Outstanding implementation marker',
      detail: 'A TODO or FIXME in the hot path usually means unfinished behavior. Either resolve it or track it outside the runtime path.',
      confidence: 72,
      fixSuggestion: 'Resolve the TODO or move the unfinished work behind a tracked issue so runtime behavior is explicit.',
    },
  );

  const emptyCatchMatch = code.match(/catch\s*\([^)]*\)\s*\{\s*\}/);
  if (emptyCatchMatch) {
    pushSuggestion({
      category: 'Bug',
      severity: 'Medium',
      title: 'Error is swallowed silently',
      detail: 'An empty `catch` block hides failures and makes debugging production issues much harder.',
      line: indexToLineNumber(code, emptyCatchMatch.index ?? 0),
      confidence: 89,
      fixSuggestion: 'Handle the caught error explicitly by logging it, rethrowing it, or returning a controlled fallback state.',
    });
  }

  if (/\bawait\b/.test(code) && !/\btry\s*\{/.test(code) && !/\.catch\s*\(/.test(code)) {
    pushSuggestion({
      category: 'Bug',
      severity: 'Medium',
      title: 'Async flow lacks visible failure handling',
      detail: 'Awaited work appears to run without an adjacent `try/catch` or promise rejection handler, which can turn transient failures into broken user flows.',
      line: findMatchingLine(lines, (line) => /\bawait\b/.test(line)),
      confidence: 79,
      fixSuggestion: 'Wrap the awaited call in `try/catch` or attach a `.catch()` handler so failures surface predictably.',
    });
  }

  if (metrics.nestingDepth >= 4 || countPattern(code, /\bfor\b|\bwhile\b/g) >= 2) {
    pushSuggestion({
      category: 'Complexity',
      severity: metrics.nestingDepth >= 5 ? 'High' : 'Medium',
      title: 'Control flow is getting dense',
      detail: 'Nested branches or loops increase the chance of missed edge cases. Extract smaller helpers or use guard clauses to flatten the path.',
      line: findMatchingLine(lines, (line) => /\bfor\b|\bwhile\b|\bif\b/.test(line)),
      confidence: 84,
      fixSuggestion: 'Split this control flow into smaller helpers or guard clauses so each branch is easier to reason about and test.',
    });
  }

  const longestFunctionLength = estimateLongestFunctionLength(lines);
  if (longestFunctionLength >= 45 || metrics.lineCount >= 180) {
    pushSuggestion({
      category: 'Improvement',
      severity: longestFunctionLength >= 70 ? 'High' : 'Medium',
      title: 'Large unit of code is hard to review',
      detail: 'This snippet contains a long function or file-sized block, which makes defects and regressions easier to miss during review.',
      line: findMatchingLine(lines, (line) => looksLikeFunctionStart(line)),
      confidence: 76,
      fixSuggestion: 'Extract smaller functions around the major responsibilities so each block has a single clear purpose.',
    });
  }

  if (/\bswitch\s*\(/.test(code) && !/\bdefault\s*:/.test(code)) {
    pushSuggestion({
      category: 'Bug',
      severity: 'Medium',
      title: 'Switch statement has no default branch',
      detail: 'Unhandled enum values or unknown states can silently fall through when a switch lacks a defensive default case.',
      line: findMatchingLine(lines, (line) => /\bswitch\s*\(/.test(line)),
      confidence: 73,
      fixSuggestion: 'Add a `default` branch that throws, logs, or returns a controlled fallback for unknown states.',
    });
  }

  const rankedSuggestions = rankSuggestions(
    suggestions.length > 0
      ? suggestions
      : [
          {
            category: 'Improvement',
            severity: 'Low',
            title: 'Add targeted tests around the main execution path',
            detail: 'No high-signal defect stood out in this static pass, so the next best upgrade is focused test coverage around the key inputs and edge cases.',
            line: findMatchingLine(lines, (line) => line.trim().length > 0),
            confidence: 62,
            fixSuggestion: 'Add focused tests around the main inputs and edge cases so future regressions are easier to catch.',
          },
        ],
    focus,
  ).slice(0, 8);
  const strengths = deriveStrengths(code, metrics, rankedSuggestions);
  const riskLevel = deriveRiskLevelFromSuggestions(rankedSuggestions);
  const scoreBreakdown = buildScoreBreakdown(rankedSuggestions, metrics);
  const qualityScore = scoreBreakdown.finalScore;
  const complexity = describeComplexity(metrics);
  const improvedCode = buildImprovedCode(code);

  return {
    summary: buildSummary(language, rankedSuggestions, riskLevel),
    suggestions: rankedSuggestions,
    complexity,
    language,
    qualityScore,
    scoreBreakdown,
    riskLevel,
    strengths,
    metrics: {
      ...metrics,
      suggestionCount: rankedSuggestions.length,
    },
    source: 'heuristic',
    reviewComments: buildReviewComments(rankedSuggestions),
    originalCode: code,
    improvedCode,
  };
}

function collectMetrics(lines: string[], code: string): ReviewMetrics {
  const lineCount = lines.filter((line) => line.trim().length > 0).length;
  const functionCount = countFunctionLikeBlocks(code);
  const branchCount = countPattern(code, /\bif\b|\belse if\b|\bfor\b|\bwhile\b|\bswitch\b|\bcase\b|\bcatch\b/g);
  const nestingDepth = estimateBraceDepth(code);
  const longestLine = lines.reduce((max, line) => Math.max(max, line.length), 0);

  return {
    lineCount,
    functionCount,
    branchCount,
    nestingDepth,
    longestLine,
    suggestionCount: 0,
  };
}

function buildSummary(language: string, suggestions: ReviewSuggestion[], riskLevel: RiskLevel): string {
  if (suggestions.length === 0) {
    return `CodeSage did not find any high-signal issues in this ${language} snippet. The code looks fairly stable from a static pass, but tests and runtime validation still matter.`;
  }

  const topTitles = suggestions.slice(0, 2).map((item) => item.title.toLowerCase());
  const mainConcern = topTitles.length === 1 ? topTitles[0] : `${topTitles[0]} and ${topTitles[1]}`;

  return `CodeSage found ${suggestions.length} actionable finding${suggestions.length === 1 ? '' : 's'} in this ${language} snippet. Current delivery risk is ${riskLevel.toLowerCase()}, driven mostly by ${mainConcern}.`;
}

function buildReviewComments(suggestions: ReviewSuggestion[], path?: string): ReviewComment[] {
  return suggestions.map((suggestion, index) => ({
    id: `${path ?? 'snippet'}-${suggestion.line ?? 'na'}-${index}`,
    line: suggestion.line,
    severity: suggestion.severity,
    body: `${suggestion.title}: ${suggestion.detail}`,
    fixSuggestion: suggestion.fixSuggestion,
    path,
  }));
}

function buildImprovedCode(code: string): string {
  let improved = code;

  improved = improved.replace(/<=\s*([A-Za-z_$][\w$]*)\.length/g, '< $1.length');
  improved = improved.replace(/([^=!<>])==([^=])/g, '$1=== $2').replace(/([^=!<>])!=([^=])/g, '$1!== $2');
  improved = improved.replace(/\bvar\b/g, 'let');
  improved = improved.replace(/\.innerHTML\s*=/g, '.textContent =');
  improved = improved
    .split(/\r?\n/)
    .filter((line) => !/\bconsole\.(log|debug|info)\s*\(/.test(line))
    .join('\n');

  return improved;
}

function deriveStrengths(code: string, metrics: ReviewMetrics, suggestions: ReviewSuggestion[]): string[] {
  const strengths: string[] = [];

  if (/\bconst\b/.test(code) && !/\bvar\b/.test(code)) {
    strengths.push('Uses block-scoped declarations, which reduces accidental leakage across scopes.');
  }

  if (/if\s*\([^)]*\)\s*return\b/.test(code) || /if\s*\([^)]*\)\s*\{\s*return\b/.test(code)) {
    strengths.push('Includes guard-style exits that help keep the happy path easier to read.');
  }

  if (/\btry\s*\{/.test(code) && /\bcatch\s*\(/.test(code)) {
    strengths.push('Error handling is present, which is better than allowing failures to disappear silently.');
  }

  if (metrics.lineCount <= 80 && metrics.functionCount <= 4) {
    strengths.push('The snippet is compact enough that refactoring and targeted tests should stay manageable.');
  }

  if (!suggestions.some((item) => item.category === 'Security')) {
    strengths.push('No obvious high-risk security pattern stood out in this static review pass.');
  }

  return strengths.slice(0, 4);
}

function describeComplexity(metrics: ReviewMetrics): string {
  const density =
    metrics.nestingDepth >= 5 || metrics.branchCount >= 10
      ? 'high'
      : metrics.nestingDepth >= 3 || metrics.branchCount >= 5
        ? 'moderate'
        : 'low';

  return `Complexity appears ${density}: ${metrics.functionCount} function-like block${metrics.functionCount === 1 ? '' : 's'}, ${metrics.branchCount} branch point${metrics.branchCount === 1 ? '' : 's'}, and estimated nesting depth ${metrics.nestingDepth}.`;
}

function buildScoreBreakdown(suggestions: ReviewSuggestion[], metrics: ReviewMetrics): ScoreBreakdown {
  const startingScore = 100;
  const grouped = new Map<ScoreDeduction['category'], ScoreDeduction>();

  for (const suggestion of suggestions) {
    const key = suggestion.category;
    const existing = grouped.get(key);
    const points = severityWeights[suggestion.severity];

    if (existing) {
      existing.points += points;
      existing.reason = `${existing.reason}; ${suggestion.title}`;
    } else {
      grouped.set(key, {
        category: suggestion.category,
        label: suggestion.category,
        points,
        reason: suggestion.title,
      });
    }
  }

  if (metrics.nestingDepth >= 4) {
    const existing = grouped.get('Complexity');
    if (existing) {
      existing.points += 4;
      existing.reason = `${existing.reason}; deep nesting increases review difficulty`;
    } else {
      grouped.set('Complexity', {
        category: 'Complexity',
        label: 'Complexity',
        points: 4,
        reason: 'Deep nesting increases review difficulty.',
      });
    }
  }

  if (metrics.longestLine >= 160) {
    grouped.set('Maintainability', {
      category: 'Maintainability',
      label: 'Maintainability',
      points: (grouped.get('Maintainability')?.points ?? 0) + 2,
      reason: 'Very long lines make the code harder to scan and maintain.',
    });
  }

  const deductions = [...grouped.values()]
    .filter((item) => item.points > 0)
    .sort((left, right) => right.points - left.points);

  const finalScore = clamp(
    startingScore - deductions.reduce((total, item) => total + item.points, 0),
    18,
    100,
  );

  return {
    startingScore,
    deductions,
    finalScore,
  };
}

function deriveRiskLevelFromSuggestions(suggestions: ReviewSuggestion[]): RiskLevel {
  if (suggestions.some((item) => item.severity === 'Critical')) {
    return 'Critical';
  }

  const highCount = suggestions.filter((item) => item.severity === 'High').length;
  if (highCount >= 2) {
    return 'High';
  }

  if (highCount === 1 || suggestions.filter((item) => item.severity === 'Medium').length >= 2) {
    return 'Medium';
  }

  return suggestions.length === 0 ? 'Low' : 'Low';
}

function mergeReviews(aiReview: ReviewResponse, heuristicReview: ReviewResponse, focus: ReviewFocus): ReviewResponse {
  const suggestions = rankSuggestions(
    dedupeSuggestions([...aiReview.suggestions, ...heuristicReview.suggestions]),
    focus,
  ).slice(0, 8);

  const scoreBreakdown = buildScoreBreakdown(suggestions, heuristicReview.metrics);
  const qualityScore = clamp(Math.round((aiReview.qualityScore + scoreBreakdown.finalScore) / 2), 0, 100);

  const riskLevel =
    riskWeights[aiReview.riskLevel] >= riskWeights[heuristicReview.riskLevel]
      ? aiReview.riskLevel
      : heuristicReview.riskLevel;

  const strengths = uniqueStrings([...aiReview.strengths, ...heuristicReview.strengths]).slice(0, 4);

  return {
    summary: aiReview.summary,
    complexity: aiReview.complexity,
    language: aiReview.language || heuristicReview.language,
    qualityScore,
    scoreBreakdown: {
      ...scoreBreakdown,
      finalScore: qualityScore,
    },
    riskLevel,
    strengths,
    suggestions,
    metrics: {
      ...heuristicReview.metrics,
      suggestionCount: suggestions.length,
    },
    source: 'hybrid',
    reviewComments: buildReviewComments(suggestions),
    originalCode: heuristicReview.originalCode,
    improvedCode: heuristicReview.improvedCode,
  };
}

function normalizeSuggestions(input: unknown): ReviewSuggestion[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const normalized: ReviewSuggestion[] = [];

  for (const item of input) {
    if (!isRecord(item)) {
      continue;
    }

    const category = normalizeCategory(item.category);
    const severity = normalizeSeverity(item.severity);
    const title = asTrimmedString(item.title);
    const detail = asTrimmedString(item.detail);
    const confidence = clamp(asInteger(item.confidence) ?? 70, 0, 100);
    const line = normalizeLine(item.line);
    const fixSuggestion = asTrimmedString(item.fixSuggestion) ?? undefined;

    if (!category || !severity || !title || !detail) {
      continue;
    }

    normalized.push({
      category,
      severity,
      title,
      detail,
      line,
      confidence,
      fixSuggestion,
    });
  }

  return normalized;
}

function normalizeStrengths(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return uniqueStrings(
    input
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter((item) => item.length > 0),
  ).slice(0, 4);
}

function normalizeCategory(value: unknown): ReviewCategory | null {
  if (typeof value !== 'string') {
    return null;
  }

  return reviewCategories.find((item) => item.toLowerCase() === value.toLowerCase()) ?? null;
}

function normalizeSeverity(value: unknown): ReviewSeverity | null {
  if (typeof value !== 'string') {
    return null;
  }

  return severities.find((item) => item.toLowerCase() === value.toLowerCase()) ?? null;
}

function normalizeRiskLevel(value: unknown): RiskLevel | null {
  if (typeof value !== 'string') {
    return null;
  }

  return riskLevels.find((item) => item.toLowerCase() === value.toLowerCase()) ?? null;
}

function normalizeLine(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  const rounded = Math.round(value);
  return rounded >= 1 ? rounded : null;
}

function rankSuggestions(suggestions: ReviewSuggestion[], focus: ReviewFocus): ReviewSuggestion[] {
  const focusPriority: Record<ReviewFocus, ReviewCategory[]> = {
    full: ['Bug', 'Security', 'Complexity', 'Improvement', 'Style'],
    security: ['Security', 'Bug', 'Complexity', 'Improvement', 'Style'],
    quality: ['Bug', 'Improvement', 'Complexity', 'Style', 'Security'],
    performance: ['Complexity', 'Improvement', 'Bug', 'Style', 'Security'],
  };

  const categoryOrder = focusPriority[focus];

  return [...suggestions].sort((left, right) => {
    const severityDelta = severityRank(right.severity) - severityRank(left.severity);
    if (severityDelta !== 0) {
      return severityDelta;
    }

    const categoryDelta =
      categoryOrder.indexOf(left.category) - categoryOrder.indexOf(right.category);
    if (categoryDelta !== 0) {
      return categoryDelta;
    }

    const confidenceDelta = right.confidence - left.confidence;
    if (confidenceDelta !== 0) {
      return confidenceDelta;
    }

    return (left.line ?? 99999) - (right.line ?? 99999);
  });
}

function dedupeSuggestions(suggestions: ReviewSuggestion[]): ReviewSuggestion[] {
  const seen = new Set<string>();
  const deduped: ReviewSuggestion[] = [];

  for (const suggestion of suggestions) {
    const key = `${suggestion.category}:${suggestion.title.toLowerCase()}:${suggestion.line ?? 'na'}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(suggestion);
  }

  return deduped;
}

function detectLanguage(code: string, filename?: string): string {
  const extension = filename?.split('.').pop()?.toLowerCase();
  if (extension === 'ts' || extension === 'tsx') return 'TypeScript';
  if (extension === 'js' || extension === 'jsx') return 'JavaScript';
  if (extension === 'py') return 'Python';
  if (extension === 'java') return 'Java';
  if (extension === 'go') return 'Go';
  if (extension === 'cs') return 'C#';
  if (extension === 'cpp' || extension === 'cc' || extension === 'cxx') return 'C++';
  if (extension === 'c') return 'C';
  if (extension === 'json') return 'JSON';

  if (/interface\s+\w+|type\s+\w+\s*=|:\s*string\b|import\s+type\b/.test(code)) return 'TypeScript';
  if (/def\s+\w+\(|import\s+\w+|from\s+\w+\s+import/.test(code)) return 'Python';
  if (/public\s+class\s+\w+|System\.|namespace\s+\w+/.test(code)) return 'C#';
  if (/package\s+\w+;|public\s+class\s+\w+/.test(code)) return 'Java';
  if (/func\s+\w+\(|package\s+main/.test(code)) return 'Go';
  if (/\#include\s+</.test(code)) return 'C/C++';
  if (/const\s+\w+\s*=|function\s+\w+\(|=>/.test(code)) return 'JavaScript';

  return 'Unknown';
}

function countFunctionLikeBlocks(code: string): number {
  const matches = code.match(
    /\bfunction\b|=>\s*\{|^[ \t]*[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{/gm,
  );

  return matches?.length ?? 0;
}

function estimateBraceDepth(code: string): number {
  let currentDepth = 0;
  let maxDepth = 0;

  for (const char of code) {
    if (char === '{') {
      currentDepth += 1;
      maxDepth = Math.max(maxDepth, currentDepth);
    } else if (char === '}') {
      currentDepth = Math.max(0, currentDepth - 1);
    }
  }

  return maxDepth;
}

function estimateLongestFunctionLength(lines: string[]): number {
  let longest = 0;
  let activeFunctionLength = 0;
  let functionBraceDepth = 0;
  let trackingFunction = false;

  for (const line of lines) {
    if (!trackingFunction && looksLikeFunctionStart(line)) {
      trackingFunction = true;
      activeFunctionLength = 1;
      functionBraceDepth = countCharacter(line, '{') - countCharacter(line, '}');

      if (functionBraceDepth <= 0) {
        longest = Math.max(longest, activeFunctionLength);
        trackingFunction = false;
      }

      continue;
    }

    if (!trackingFunction) {
      continue;
    }

    activeFunctionLength += 1;
    functionBraceDepth += countCharacter(line, '{');
    functionBraceDepth -= countCharacter(line, '}');

    if (functionBraceDepth <= 0) {
      longest = Math.max(longest, activeFunctionLength);
      trackingFunction = false;
    }
  }

  return longest;
}

function looksLikeFunctionStart(line: string): boolean {
  return /\bfunction\b|=>\s*\{|^[ \t]*(async\s+)?[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{/.test(line);
}

function hasLooseEquality(line: string): boolean {
  const compact = line.replace(/\s+/g, '');
  return compact.includes('==') && !compact.includes('===') || compact.includes('!=') && !compact.includes('!==');
}

function findMatchingLine(lines: string[], predicate: (line: string) => boolean): number | null {
  const index = lines.findIndex((line) => predicate(line));
  return index >= 0 ? index + 1 : null;
}

function countPattern(text: string, pattern: RegExp): number {
  const matches = text.match(pattern);
  return matches?.length ?? 0;
}

function countCharacter(text: string, character: string): number {
  let count = 0;

  for (const char of text) {
    if (char === character) {
      count += 1;
    }
  }

  return count;
}

function indexToLineNumber(text: string, index: number): number {
  return text.slice(0, index).split(/\r?\n/).length;
}

function severityRank(severity: ReviewSeverity): number {
  return severities.length - severities.indexOf(severity);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asInteger(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  return Math.round(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
