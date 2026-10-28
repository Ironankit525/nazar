/** Rough token estimate. Code tokenizes denser than prose; 3.2 chars/token keeps us on the safe side. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.2);
}
