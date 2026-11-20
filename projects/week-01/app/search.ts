import type { Evidence, Subject, Version } from './corpus.ts';

export const FIXTURE_TODAY = '2026-11-18';

const PRINCIPALS = {
  employee: { subject: 'employee', itAdmin: false },
  contractor: { subject: 'contractor', itAdmin: false },
  'it-admin': { subject: 'employee', itAdmin: true },
} as const;

export type PrincipalFixture = keyof typeof PRINCIPALS;

export interface Scope {
  principal: (typeof PRINCIPALS)[PrincipalFixture];
  subject: Subject;
  asOf: string;
}

export function isPrincipalFixture(value: string): value is PrincipalFixture {
  return Object.hasOwn(PRINCIPALS, value);
}

export function isPolicyDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value > FIXTURE_TODAY) return false;
  const time = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(time) && new Date(time).toISOString().startsWith(value);
}

export function scopeFor(fixture: PrincipalFixture, asOf = FIXTURE_TODAY, subject?: Subject): Scope {
  const principal = PRINCIPALS[fixture];
  return { principal, subject: subject ?? principal.subject, asOf };
}

export function canRead(version: Version, scope: Scope): boolean {
  return version.access === 'internal' || (version.access === 'it-admin' && scope.principal.itAdmin);
}

export function appliesTo(version: Version, scope: Scope): boolean {
  return version.audience.includes(scope.subject);
}

export function versionAvailability(version: Version, scope: Scope) {
  if (version.status !== 'published') return 'unpublished';
  if (scope.asOf < version.valid_from) return 'future';
  if (version.valid_until !== null && scope.asOf >= version.valid_until) return 'expired';
  return 'valid';
}

export function evidenceRef(version: Version, evidence: Evidence): string {
  return `${version.version_id}#${evidence.anchor}`;
}

const CJK_TERMS = [
  '更换手机', '登录验证', '重新绑定', '管理员处置', '旧手机遗失',
  '验证器恢复', '内网密码', '密码重置', '密码到期', '办公', '访客',
  '客户端更新', '恢复密钥', '运维控制台',
];

function terms(text: string): Set<string> {
  const normalized = text.normalize('NFKC').toLowerCase();
  const ascii = normalized.match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? [];
  const chinese = CJK_TERMS.filter((term) => normalized.includes(term));
  return new Set([...ascii, ...chinese]);
}

export interface Hit {
  version: Version;
  evidence: Evidence;
  ref: string;
  score: number;
}

export function search(
  corpus: Version[],
  query: string,
  scope: Scope,
  options: { omitExpiryForReplay?: boolean } = {},
) {
  const queryTerms = [...terms(query)];
  const rejectedExpired: string[] = [];
  const hits: Hit[] = [];

  for (const version of corpus) {
    if (!canRead(version, scope) || !appliesTo(version, scope)) continue;
    const availability = versionAvailability(version, scope);
    if (availability === 'unpublished' || availability === 'future') continue;
    if (availability === 'expired' && !options.omitExpiryForReplay) {
      rejectedExpired.push(version.version_id);
      continue;
    }

    const titleTerms = terms(version.title);
    const titleMatches = queryTerms.filter((term) => titleTerms.has(term)).length;
    for (const evidence of version.evidence) {
      const bodyTerms = terms(evidence.text);
      const bodyMatches = queryTerms.filter((term) => bodyTerms.has(term)).length;
      if (bodyMatches > 0) {
        hits.push({
          version,
          evidence,
          ref: evidenceRef(version, evidence),
          score: 3 * titleMatches + bodyMatches,
        });
      }
    }
  }

  hits.sort((a, b) => b.score - a.score || a.ref.localeCompare(b.ref, 'en'));
  return { hits, queryTerms, rejectedExpired };
}
