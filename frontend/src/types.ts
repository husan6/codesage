export type ReviewCategory = 'Bug' | 'Improvement' | 'Complexity' | 'Security' | 'Style';
export type ReviewSeverity = 'Critical' | 'High' | 'Medium' | 'Low';
export type RiskLevel = 'Low' | 'Medium' | 'High' | 'Critical';
export type ReviewSource = 'heuristic' | 'hybrid';
export type ReviewFocus = 'full' | 'security' | 'quality' | 'performance';

export interface ApiStatusResponse {
  status: 'ok';
  aiEnabled: boolean;
  model: string;
  githubTokenConfigured: boolean;
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

export interface ReviewContext {
  kind: 'snippet' | 'github-file' | 'github-pr';
  label: string;
  url?: string;
  repository?: string;
  pullRequestNumber?: number;
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
