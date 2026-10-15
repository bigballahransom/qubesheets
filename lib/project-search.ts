// lib/project-search.ts
//
// Org-scoped free-text project search, shared by the external REST list
// route (?q=) and the MCP find_project tool. Matching semantics:
//   - query is tokenized on whitespace; EVERY token must match somewhere
//     (name, customerName, customerCompanyName, customerEmail), so
//     "Sarah Johnson" narrows instead of exploding
//   - any run of 4+ digits in the query also matches as a substring of the
//     stored phone (+1XXXXXXXXXX is contiguous, so "555-1234" -> /5551234/)
//   - zero strict matches fall back to any-token matching (fuzzy: true)
// User text goes into regexes, so metacharacters are escaped and the query
// is length/token capped before it touches Mongo.

import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';

const MAX_QUERY_LENGTH = 100;
const MAX_TOKENS = 6;

export interface ProjectSearchResult {
  projects: any[];
  fuzzy: boolean;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tokenClause(token: string): Record<string, any> {
  const rx = new RegExp(escapeRegex(token), 'i');
  return {
    $or: [
      { name: rx },
      { customerName: rx },
      { customerCompanyName: rx },
      { customerEmail: rx },
    ],
  };
}

export async function searchProjects(
  organizationId: string,
  query: string,
  limit: number
): Promise<ProjectSearchResult> {
  await connectMongoDB();

  const q = (query || '').trim().slice(0, MAX_QUERY_LENGTH);
  const tokens = q.split(/\s+/).filter(Boolean).slice(0, MAX_TOKENS);
  if (tokens.length === 0) {
    return { projects: [], fuzzy: false };
  }

  const clauses: Record<string, any>[] = tokens.map(tokenClause);

  // Phone path: a 4+ digit run matches the stored +1XXXXXXXXXX as substring.
  const digits = q.replace(/\D/g, '');
  if (digits.length >= 4) {
    clauses.push({ phone: new RegExp(escapeRegex(digits)) });
  }

  const run = (filter: Record<string, any>) =>
    Project.find({ organizationId, ...filter })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .select('name customerName customerCompanyName customerEmail phone origin destination createdAt updatedAt')
      .lean<any[]>();

  // Strict: every token matches somewhere (phone clause counts as a match
  // for the digit token it came from, so OR it against the AND block).
  const strictFilter =
    digits.length >= 4
      ? { $or: [{ $and: clauses.slice(0, tokens.length) }, clauses[clauses.length - 1]] }
      : { $and: clauses };

  let projects = await run(strictFilter);
  if (projects.length > 0) {
    return { projects, fuzzy: false };
  }

  // Fuzzy fallback: any token matches.
  projects = await run({ $or: clauses });
  return { projects, fuzzy: true };
}
