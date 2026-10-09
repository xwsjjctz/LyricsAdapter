import { logger } from '../logger';

/** Covers resolved per surface; the native side keeps a matching cache. */
const MAX_REQUESTED_COVERS = 300;
const COVER_CONCURRENCY = 4;

export interface CoverQueue {
  /** Queues every URL not already requested since the last reset. */
  request: (urls: Iterable<string>) => void;
  /** Forgets requested URLs; covers still loading are dropped when they finish. */
  reset: () => void;
}

/** Resolves each cover URL once, a few at a time, for one native surface. */
export function createCoverQueue(
  resolveCover: (url: string) => Promise<Buffer | null>,
  deliver: (url: string, data: Buffer) => void,
  tag: string,
): CoverQueue {
  let revision = 0;
  let requested = new Set<string>();
  let queue: string[] = [];
  let inFlight = 0;

  const pump = () => {
    while (inFlight < COVER_CONCURRENCY && queue.length > 0) {
      const url = queue.shift()!;
      const current = revision;
      inFlight++;
      resolveCover(url)
        .then(data => { if (data && current === revision) deliver(url, data); })
        .catch(error => logger.debug(`[${tag}] Cover unavailable:`, url, error))
        .finally(() => { inFlight--; pump(); });
    }
  };

  return {
    request: urls => {
      for (const url of urls) {
        if (requested.has(url)) continue;
        // Both sides drop their caches together; covers reload on demand.
        if (requested.size >= MAX_REQUESTED_COVERS) requested = new Set();
        requested.add(url);
        queue.push(url);
      }
      pump();
    },
    reset: () => {
      revision++;
      requested = new Set();
      queue = [];
    },
  };
}
