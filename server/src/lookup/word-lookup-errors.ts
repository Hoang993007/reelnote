/** Every code the word lookup route answers with besides the access errors. */
export type WordLookupErrorCode =
  | 'lookup-off'
  | 'lookup-not-in-line'
  | 'lookup-limit'
  | 'lookup-key-refused'
  | 'lookup-failed';

/** A public error: `lib/http-error-handler.ts` sends its status, code, message and details. */
export class WordLookupError extends Error {
  public readonly publicError = true;

  public constructor(
    message: string,
    public readonly code: WordLookupErrorCode,
    public readonly statusCode: number,
    public readonly details: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.name = 'WordLookupError';
  }
}

export const lookupOff = () => new WordLookupError('No Gemini API key: add your own, or ask the owner for a shared one', 'lookup-off', 503);

export const lookupFailed = (reason: string) =>
  new WordLookupError('The dictionary service did not answer', 'lookup-failed', 502, { reason });
