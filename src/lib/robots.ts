import { RobotsDisallowedError } from './errors';

interface RuleGroup {
  agents: string[];
  allow: string[];
  disallow: string[];
}

export function parseRobots(text: string): RuleGroup[] {
  const groups: RuleGroup[] = [];
  let current: RuleGroup | null = null;
  let collectingAgents = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (key === 'user-agent') {
      if (!current || !collectingAgents) {
        current = { agents: [], allow: [], disallow: [] };
        groups.push(current);
        collectingAgents = true;
      }
      current.agents.push(value.toLowerCase());
    } else if (current && (key === 'allow' || key === 'disallow')) {
      collectingAgents = false;
      current[key].push(value);
    }
  }
  return groups;
}

export function isPathAllowed(groups: RuleGroup[], path: string, userAgent: string): boolean {
  const agent = userAgent.toLowerCase();
  for (const group of groups) {
    if (!group.agents.some((candidate) => candidate === '*' || agent.includes(candidate))) continue;
    let allowLength = -1;
    let disallowLength = -1;
    for (const rule of group.allow) {
      if (rule && path.startsWith(rule)) allowLength = Math.max(allowLength, rule.length);
    }
    for (const rule of group.disallow) {
      if (rule && path.startsWith(rule)) disallowLength = Math.max(disallowLength, rule.length);
    }
    if (disallowLength > allowLength) return false;
  }
  return true;
}

/** Fail-open on robots.txt network errors (standard practice); honor explicit rules. */
export async function assertRobotsAllowed(
  url: URL,
  options: { timeoutMs: number; userAgent: string },
): Promise<void> {
  let robotsUrl: URL;
  try {
    robotsUrl = new URL('/robots.txt', url.origin);
  } catch {
    return;
  }
  let response: Response;
  try {
    response = await fetch(robotsUrl.toString(), {
      redirect: 'follow',
      signal: AbortSignal.timeout(options.timeoutMs),
      headers: { 'user-agent': options.userAgent },
    });
  } catch {
    return;
  }
  if (!response.ok) return;
  const text = await response.text().catch(() => '');
  const path = `${url.pathname}${url.search}`;
  if (!isPathAllowed(parseRobots(text.slice(0, 100_000)), path, options.userAgent)) {
    throw new RobotsDisallowedError(url.hostname);
  }
}
