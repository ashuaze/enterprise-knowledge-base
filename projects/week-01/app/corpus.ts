import { readFileSync } from 'node:fs';

export type Subject = 'employee' | 'contractor';

export interface Evidence {
  anchor: string;
  heading: string;
  text: string;
}

interface Metadata {
  document_id: string;
  version_id: string;
  title: string;
  owner: string;
  source: string;
  status: 'published' | 'draft';
  valid_from: string;
  valid_until: string | null;
  access: 'internal' | 'it-admin';
  audience: Subject[];
}

export interface Version extends Metadata {
  evidence: Evidence[];
}

export function loadCorpus(): Version[] {
  const metadata: Metadata[] = JSON.parse(
    readFileSync(new URL('../fixtures/versions.json', import.meta.url), 'utf8'),
  );
  return metadata.map((version) => {
    const path = new URL(`../fixtures/markdown/${version.version_id}.md`, import.meta.url);
    const markdown = readFileSync(path, 'utf8').replaceAll('\r\n', '\n').trim();
    const [title, ...sections] = markdown.split(/^## /m);
    if (title.trim() !== `# ${version.title}` || sections.length === 0) {
      throw new Error(`Invalid fixture title or missing sections: ${version.version_id}`);
    }
    const seen = new Set<string>();
    const evidence = sections.map((section) => {
      const [header, ...lines] = section.trim().split('\n');
      const match = /^(.+) \{#([a-z0-9-]+)\}$/.exec(header);
      const text = lines.join('\n').trim();
      if (!match || seen.has(match[2]) || !text || text.includes('\n')) {
        throw new Error(`Expected a unique anchor and one plain paragraph: ${version.version_id}`);
      }
      const [, heading, anchor] = match;
      seen.add(anchor);
      return { anchor, heading, text };
    });
    return { ...version, evidence };
  });
}
