import Fastify, { type FastifyReply } from 'fastify';
import { loadCorpus, type Subject } from './corpus.ts';
import {
  appliesTo, canRead, evidenceRef, isPolicyDate, isPrincipalFixture, scopeFor, search, versionAvailability,
} from './search.ts';

interface ScopeQuery {
  as_of?: string;
  subject?: Subject;
}

interface SearchQuery extends ScopeQuery {
  q: string;
  limit?: number;
}

const scopeProperties = {
  as_of: { type: 'string', minLength: 10, maxLength: 10 },
  subject: { type: 'string', enum: ['employee', 'contractor'] },
};

function requestScope(authorization: string | undefined, query: ScopeQuery, reply: FastifyReply) {
  // The local demo maps fixed bearer tokens to server-owned identities.
  const token = /^Bearer demo-([a-z-]+)$/.exec(authorization ?? '')?.[1];
  if (!token || !isPrincipalFixture(token)) {
    reply.header('WWW-Authenticate', 'Bearer').code(401).send({ error: 'fixture_identity_required' });
    return;
  }
  if (query.as_of !== undefined && !isPolicyDate(query.as_of)) {
    reply.code(400).send({ error: 'invalid_policy_date' });
    return;
  }
  return scopeFor(token, query.as_of, query.subject);
}

function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

export function buildApp(corpus = loadCorpus()) {
  const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });

  app.addHook('onRequest', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
  });

  app.get<{ Querystring: SearchQuery }>('/search', {
    schema: {
      querystring: {
        type: 'object',
        additionalProperties: false,
        required: ['q'],
        properties: {
          ...scopeProperties,
          q: { type: 'string', minLength: 1, maxLength: 200 },
          limit: { type: 'integer', minimum: 1, maximum: 10 },
        },
      },
    },
  }, (request, reply) => {
    const scope = requestScope(request.headers.authorization, request.query, reply);
    if (!scope) return reply;
    const { q, limit = 10 } = request.query;
    if (!q.trim()) return reply.code(400).send({ error: 'empty_query' });

    const { hits } = search(corpus, q.trim(), scope);
    const sourceQuery = new URLSearchParams({ as_of: scope.asOf, subject: scope.subject });
    const results = hits.slice(0, limit).map(({ version, evidence }) => ({
      document_id: version.document_id,
      version_id: version.version_id,
      evidence_ref: evidenceRef(version, evidence),
      title: version.title,
      section: evidence.heading,
      snippet: evidence.text,
      source_url: `/sources/${version.version_id}?${sourceQuery}#${evidence.anchor}`,
    }));
    return { as_of: scope.asOf, subject: scope.subject, results };
  });

  app.get<{ Params: { versionId: string }; Querystring: ScopeQuery }>('/sources/:versionId', {
    schema: {
      querystring: { type: 'object', additionalProperties: false, properties: scopeProperties },
    },
  }, (request, reply) => {
    const scope = requestScope(request.headers.authorization, request.query, reply);
    if (!scope) return reply;
    const version = corpus.find(({ version_id }) => version_id === request.params.versionId);
    if (!version || !canRead(version, scope) || !appliesTo(version, scope) || versionAvailability(version, scope) !== 'valid') {
      return reply.code(404).send({ error: 'source_unavailable' });
    }
    const sections = version.evidence.map(({ heading, anchor, text }) =>
      `<h2 id="${escapeHtml(anchor)}">${escapeHtml(heading)}</h2><p>${escapeHtml(text)}</p>`,
    ).join('\n');
    const title = escapeHtml(version.title);
    return reply.type('text/html; charset=utf-8').send(
      `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${title}</title><main>`
      + `<h1>${title}</h1><p>${escapeHtml(version.owner)} · ${escapeHtml(version.version_id)}</p>`
      + sections + '</main></html>',
    );
  });

  return app;
}
