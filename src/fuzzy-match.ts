export interface FuzzyMatch<T> {
  item: T;
  score: number;
}

function normalise(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, " ");
}

function splitWords(text: string): string[] {
  return text.split(" ").filter((w) => w.length > 0);
}

export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;

  // Create a (m+1) x (n+1) matrix
  const dp: number[][] = [];
  for (let i = 0; i <= m; i++) {
    dp[i] = [];
    for (let j = 0; j <= n; j++) {
      if (i === 0) {
        dp[i][j] = j;
      } else if (j === 0) {
        dp[i][j] = i;
      } else {
        dp[i][j] = 0;
      }
    }
  }

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(
          dp[i - 1][j],     // deletion
          dp[i][j - 1],     // insertion
          dp[i - 1][j - 1], // substitution
        );
      }
    }
  }

  return dp[m][n];
}

export function fuzzyMatchName<T>(
  query: string,
  candidates: T[],
  getName: (item: T) => string,
  minScore: number = 40,
): FuzzyMatch<T>[] {
  const normQuery = normalise(query);
  const queryWords = splitWords(normQuery);

  if (queryWords.length === 0) {
    return [];
  }

  const results: FuzzyMatch<T>[] = [];

  for (const item of candidates) {
    const name = getName(item);
    const normName = normalise(name);
    const candidateWords = splitWords(normName);

    if (candidateWords.length === 0) {
      continue;
    }

    const score = computeScore(normQuery, queryWords, normName, candidateWords);

    if (score >= minScore) {
      results.push({ item, score });
    }
  }

  results.sort((a, b) => b.score - a.score);

  return results;
}

function computeScore(
  normQuery: string,
  queryWords: string[],
  normCandidate: string,
  candidateWords: string[],
): number {
  // Tier 1: Exact normalised match
  if (normQuery === normCandidate) {
    return 100;
  }

  // Tier 2: Candidate starts with query
  if (normCandidate.startsWith(normQuery)) {
    return 80;
  }

  // Tier 3: All query words found in candidate words
  const queryWordsInCandidate = queryWords.filter((qw) =>
    candidateWords.some((cw) => cw === qw),
  );
  if (queryWordsInCandidate.length === queryWords.length) {
    return 65 + (queryWordsInCandidate.length / candidateWords.length) * 14;
  }

  // Tier 4: All candidate words found in query words
  const candidateWordsInQuery = candidateWords.filter((cw) =>
    queryWords.some((qw) => qw === cw),
  );
  if (candidateWordsInQuery.length === candidateWords.length) {
    return 50 + (candidateWordsInQuery.length / queryWords.length) * 14;
  }

  // Tier 5: Per-word edit distance — all query words have a close match in candidate words
  // Only applies for multi-word queries (single-word cases fall through to whole-string tier)
  if (queryWords.length > 1) {
    const allWordsClose = queryWords.every((qw) =>
      candidateWords.some((cw) => levenshteinDistance(qw, cw) <= 2),
    );
    if (allWordsClose) {
      return 50;
    }
  }

  // Tier 6: Partial word overlap
  const matchingWords = queryWords.filter((qw) =>
    candidateWords.some((cw) => cw === qw),
  ).length;
  const maxWords = Math.max(queryWords.length, candidateWords.length);

  if (matchingWords > 0) {
    return (matchingWords / maxWords) * 50;
  }

  // Tier 7: Whole-string edit distance
  const distance = levenshteinDistance(normQuery, normCandidate);
  const maxLen = Math.max(normQuery.length, normCandidate.length);
  if (maxLen <= 5 && distance <= 2) {
    return 45;
  }
  if (maxLen > 5 && distance <= 2) {
    return 40;
  }

  // Tier 8: No match
  return 0;
}
