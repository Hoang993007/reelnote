/** What a selected word or phrase means in its transcript line, in Vietnamese (the popup's content). */
export type WordLookupResult = {
  /** The dictionary form ("grasp" for "grasped"). */
  lemma: string;
  /** IPA of the lemma, or empty when the model gave none. */
  ipa: string;
  /** Part of speech, in Vietnamese ("động từ", "cụm từ"). */
  partOfSpeech: string;
  /** What it means in this line. */
  meaning: string;
  /** One or two sentences on why it means that here (sense in the subject, idiom, grammar). */
  explanation: string;
  /** Other common meanings, a few at most. */
  otherMeanings: string[];
  /** The whole line in Vietnamese. */
  lineTranslation: string;
};

/** The route's answer: the result, and whether it came from the stored lookups. */
export type WordLookup = { term: string; result: WordLookupResult; cached: boolean };

/** What the model is given: the selection, its line and the lines around it. */
export type WordLookupQuestion = { term: string; line: string; before: string; after: string };

/** Asks the model with this API key; rejects with a `WordLookupError` when it cannot answer. */
export type AskModel = (question: WordLookupQuestion, apiKey: string) => Promise<{ result: WordLookupResult; model: string }>;

/** One turn of the follow-up chat about a lookup. */
export type ChatTurn = { role: 'user' | 'model'; text: string };

/** The chat so far (starting and ending with the user), about this lookup and its answer. */
export type ChatInput = { question: WordLookupQuestion; answer: WordLookupResult; turns: ChatTurn[] };

/** Answers the user's last turn, in markdown; rejects with a `WordLookupError` like `AskModel`. */
export type AskChat = (input: ChatInput, apiKey: string) => Promise<string>;

/** The key a user's lookups use (`lookup-key-service.ts`); null = lookup off for them. */
export type KeyFor = (userId: number) => { key: string; own: boolean } | null;
