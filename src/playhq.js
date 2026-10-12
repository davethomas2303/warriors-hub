// Minimal PlayHQ public API client.
// Docs: https://docs.playhq.com/tech  (public endpoints only return data marked VISIBLE in the admin portal)

const BASE_URL = 'https://api.playhq.com';

// Tried in order when PLAYHQ_TENANT is not set.
const TENANT_CANDIDATES = ['basketball', 'bv', 'basketball-victoria', 'bball'];

export class PlayHQError extends Error {
  constructor(status, path, body) {
    super(`PlayHQ ${status} on ${path}: ${body.slice(0, 300)}`);
    this.status = status;
    this.path = path;
  }
}

export class PlayHQ {
  constructor({ apiKey, tenant }) {
    if (!apiKey) throw new Error('PLAYHQ_API_KEY is missing from .env');
    this.apiKey = apiKey;
    this.tenant = tenant || null;
  }

  async request(path, { tenant = this.tenant } = {}) {
    const res = await fetch(BASE_URL + path, {
      headers: {
        'x-api-key': this.apiKey,
        'x-phq-tenant': tenant,
        Accept: 'application/json',
      },
    });
    const text = await res.text();
    if (!res.ok) throw new PlayHQError(res.status, path, text);
    return text ? JSON.parse(text) : null;
  }

  // Follows PlayHQ cursor pagination ({ data, metadata: { hasMore, nextCursor } }).
  async list(path) {
    const items = [];
    let cursor = null;
    do {
      const sep = path.includes('?') ? '&' : '?';
      const page = await this.request(cursor ? `${path}${sep}cursor=${encodeURIComponent(cursor)}` : path);
      items.push(...(page?.data ?? []));
      cursor = page?.metadata?.hasMore ? page.metadata.nextCursor : null;
    } while (cursor);
    return items;
  }

  // Finds a tenant value the API accepts for this organisation, if none was configured.
  async resolveTenant(orgId) {
    if (this.tenant) return this.tenant;
    const errors = [];
    for (const candidate of TENANT_CANDIDATES) {
      try {
        await this.request(`/v1/organisations/${orgId}/seasons`, { tenant: candidate });
        this.tenant = candidate;
        return candidate;
      } catch (err) {
        errors.push(`  ${candidate}: ${err.message}`);
      }
    }
    throw new Error(`No tenant value worked. Set PLAYHQ_TENANT in .env.\n${errors.join('\n')}`);
  }

  seasons(orgId) {
    return this.list(`/v1/organisations/${orgId}/seasons`);
  }

  grades(seasonId) {
    return this.list(`/v1/seasons/${seasonId}/grades`);
  }

  teams(seasonId) {
    return this.list(`/v1/seasons/${seasonId}/teams`);
  }

  // v1 = non-cricket sports (v2 is cricket only, per PlayHQ).
  gradeFixture(gradeId) {
    return this.list(`/v1/grades/${gradeId}/games`);
  }
}

export function clientFromEnv() {
  // Locally settings come from .env; on GitHub Actions they're already in the environment.
  try {
    process.loadEnvFile(new URL('../.env', import.meta.url));
  } catch {
    if (!process.env.PLAYHQ_API_KEY) {
      throw new Error('No .env file found in the project folder (copy .env.example to .env)');
    }
  }
  return {
    client: new PlayHQ({ apiKey: process.env.PLAYHQ_API_KEY, tenant: process.env.PLAYHQ_TENANT }),
    orgId: process.env.PLAYHQ_ORG_ID,
    clubId: process.env.PLAYHQ_CLUB_ID,
  };
}
