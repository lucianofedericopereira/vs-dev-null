import { baseUrl } from './config';

export interface User {
  id: string;
  username: string;
  name: string | null;
  avatar_url: string | null;
  bio: string | null;
  company: string | null;
  location: string | null;
  website: string | null;
  github_url: string;
  html_url: string;
  feed_url: string;
  created_at: string;
  commits_count?: number;
  followers_count?: number;
  following_count?: number;
}

export interface LinkPreview {
  url: string;
  title: string | null;
  description: string | null;
  image_url: string | null;
  site_name: string | null;
  is_pending: boolean;
  embed: { provider: string; kind: string; src: string; poster: string | null } | null;
}

export interface CommitImage {
  id: string;
  width: number;
  height: number;
  description: string | null;
  url: string;
}

export interface Commit {
  id: string;
  short_hash: string;
  body: string;
  parent_id: string | null;
  html_url: string;
  created_at: string;
  stars_count: number;
  replies_count: number;
  link_preview: LinkPreview | null;
  images: CommitImage[];
  author: User;
}

export interface Page<T> {
  data: T[];
  meta: { next_cursor: string | null };
}

const TIMEOUT_MS = 10_000;

async function get<T>(path: string, query: Record<string, string | undefined> = {}): Promise<T> {
  const url = new URL(`${baseUrl()}/api/v1${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) {
      url.searchParams.set(key, value);
    }
  }

  let response: Response;
  try {
    response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw new Error(`request failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (response.status === 404) {
    throw new Error('not found');
  }
  if (response.status === 429) {
    throw new Error('rate limited (60 requests/minute), try again shortly');
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

const segment = encodeURIComponent;

export async function user(username: string): Promise<User> {
  return (await get<{ data: User }>(`/users/${segment(username)}`)).data;
}

export function commits(username: string, opts: { cursor?: string; replies?: boolean } = {}): Promise<Page<Commit>> {
  return get(`/users/${segment(username)}/commits`, { cursor: opts.cursor, replies: opts.replies ? '1' : undefined });
}

export function following(username: string, cursor?: string): Promise<Page<User>> {
  return get(`/users/${segment(username)}/following`, { cursor });
}

export async function commit(id: string): Promise<Commit> {
  return (await get<{ data: Commit }>(`/commits/${segment(id)}`)).data;
}
