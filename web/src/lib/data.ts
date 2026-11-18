import { api } from './api';
import { useResource } from './resource';
import type {
  Addresses, Block, ContinuePage, InsightCategory, Insights, Listed, Page, PageVideoList, Person, QuestionItem, QuestionState, Source,
} from './types';

/** The screens' reads, one cache key each (lib/resource.ts). Writes invalidate these keys by prefix. */
export const keys = {
  sources: 'sources',
  source: (id: number) => `source:${id}`,
  pages: (sourceId: number) => `pages:${sourceId}`,
  page: (id: number) => `page:${id}`,
  videos: (pageId: number) => `videos:${pageId}`,
  blocks: (pageId: number) => `blocks:${pageId}`,
  insights: (sourceId: number) => `insights:${sourceId}`,
  categories: (sourceId: number) => `categories:${sourceId}`,
  questions: (sourceId: number | 'all', state: QuestionState | 'all') => `questions:${sourceId}:${state}`,
  recent: 'continue',
  people: 'people',
  addresses: 'addresses',
};

export const useSources = () => useResource(keys.sources, () => api<Source[]>('/sources'));
export const useSource = (id: number | null) => useResource(id ? keys.source(id) : null, () => api<Source>(`/sources/${id}`));
export const usePages = (sourceId: number | null) =>
  useResource(sourceId ? keys.pages(sourceId) : null, () => api<Page[]>(`/sources/${sourceId}/pages`));
export const usePage = (id: number | null) => useResource(id ? keys.page(id) : null, () => api<Page>(`/pages/${id}`));
export const useVideos = (pageId: number | null) =>
  useResource(pageId ? keys.videos(pageId) : null, () => api<PageVideoList>(`/pages/${pageId}/videos`));
export const useBlocks = (pageId: number | null) =>
  useResource(pageId ? keys.blocks(pageId) : null, () => api<Block[]>(`/pages/${pageId}/blocks`));
export const useInsights = (sourceId: number | null) =>
  useResource(sourceId ? keys.insights(sourceId) : null, () => api<Insights>(`/sources/${sourceId}/insights`));
export const useCategories = (sourceId: number | null) =>
  useResource(sourceId ? keys.categories(sourceId) : null, () => api<InsightCategory[]>(`/sources/${sourceId}/insight-categories`));
export const useQuestions = (sourceId: number | 'all', state: QuestionState | 'all') =>
  useResource(keys.questions(sourceId, state), () => api<Listed<QuestionItem>>(
    sourceId === 'all' ? `/learning/questions?state=${state}&limit=50` : `/sources/${sourceId}/questions?state=${state}`));
export const useRecent = () => useResource(keys.recent, () => api<ContinuePage[]>('/learning/continue?limit=9'));
export const usePeople = (enabled: boolean) => useResource(enabled ? keys.people : null, () => api<Person[]>('/admin/users'));
export const useAddresses = (enabled: boolean) => useResource(enabled ? keys.addresses : null, () => api<Addresses>('/admin/addresses'));

/** Splits a stored tag list ("a, b"). */
export function splitTags(tags: string | null | undefined): string[] {
  return (tags ?? '').split(',').map((tag) => tag.trim().replace(/^#/, '')).filter(Boolean);
}

export const joinTags = (tags: string[]) => tags.join(', ');
