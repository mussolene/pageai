import type { ConfluencePage } from "../types/messages";
import { getCachedSearchResults, setCachedSearchResults } from "../storage/indexdb";

export interface ConfluenceConfig {
  baseUrl: string;
  apiToken?: string;
  username?: string;
}

export interface ConfluenceSpace {
  id?: string;
  key: string;
  name: string;
  type: "global" | "personal";
  icon?: {
    path: string;
  };
}

export interface ConfluenceSpacesResponse {
  results: Array<{
    id?: number;
    key: string;
    name: string;
    type: "global" | "personal";
    icon?: {
      path: string;
      width?: number;
      height?: number;
      isDefault?: boolean;
    };
  }>;
  start?: number;
  limit?: number;
  size?: number;
}

export interface ConfluenceSearchResult {
  results: Array<{
    id: string;
    title: string;
    space: { key: string; name: string };
    _links: { webui: string };
    body?: { storage?: { value?: string }; view?: { value?: string } };
  }>;
  _links: { base: string };
}

export interface ConfluencePageResponse {
  id: string;
  title: string;
  space: { key: string; name: string };
  _links: { webui: string; base: string };
  body?: { storage?: { value?: string }; view?: { value?: string } };
  version?: { number: number };
  history?: { createdDate: string; lastUpdated: { when: string } };
}

async function getConfig(): Promise<ConfluenceConfig | null> {
  const [syncItems, localItems] = await Promise.all([
    new Promise<Record<string, unknown>>((resolve) => {
      chrome.storage.sync.get({ confluenceBaseUrl: "" }, resolve);
    }),
    new Promise<Record<string, unknown>>((resolve) => {
      chrome.storage.local.get({ confluenceApiToken: "", confluenceUsername: "" }, resolve);
    })
  ]);

  const baseUrl = (syncItems.confluenceBaseUrl as string)?.trim();
  if (!baseUrl) {
    return null;
  }

  let apiToken = (localItems.confluenceApiToken as string) || undefined;
  let username = (localItems.confluenceUsername as string) || undefined;

  if (!apiToken && !username) {
    const syncSecrets = await new Promise<Record<string, unknown>>((resolve) => {
      chrome.storage.sync.get({ confluenceApiToken: "", confluenceUsername: "" }, resolve);
    });
    const syncToken = (syncSecrets.confluenceApiToken as string) || "";
    const syncUser = (syncSecrets.confluenceUsername as string) || "";
    if (syncToken || syncUser) {
      apiToken = syncToken || undefined;
      username = syncUser || undefined;
      chrome.storage.local.set({ confluenceApiToken: syncToken, confluenceUsername: syncUser });
    }
  }

  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    apiToken,
    username
  };
}

function extractTextFromHtml(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.textContent?.trim() || div.innerText?.trim() || "";
}

export async function searchConfluencePages(
  query: string,
  spaceKeys?: string[]
): Promise<ConfluencePage[]> {
  const config = await getConfig();
  if (!config) {
    throw new Error("Confluence API not configured");
  }

  // Try to get cached results first
  const spaceKey = spaceKeys?.length === 1 ? spaceKeys[0] : undefined;
  const cacheKey = spaceKey ? `${query}:${spaceKey}` : query;
  
  try {
    const cachedResults = await getCachedSearchResults(query, spaceKey);
    if (cachedResults && cachedResults.length > 0) {
      // Convert cached SearchResult[] back to ConfluencePage[]
      return cachedResults.map((item: any) => ({
        id: item.id,
        url: item.url,
        title: item.title,
        spaceKey: item.spaceKey,
        createdAt: item.createdAt || "",
        updatedAt: item.updatedAt || "",
        contentText: item.contentText || ""
      }));
    }
  } catch (error) {
    console.warn("Cache retrieval failed, falling back to API:", error);
  }

  const searchUrl = new URL(`${config.baseUrl}/rest/api/content/search`);
  searchUrl.searchParams.set("cql", buildCQL(query, spaceKeys));
  searchUrl.searchParams.set("expand", "body.storage,space,version,history");

  const headers: HeadersInit = {
    Accept: "application/json"
  };

  if (config.apiToken && config.username) {
    const auth = btoa(`${config.username}:${config.apiToken}`);
    headers.Authorization = `Basic ${auth}`;
  } else if (config.apiToken) {
    headers.Authorization = `Bearer ${config.apiToken}`;
  }

  const response = await fetch(searchUrl.toString(), { headers });

  if (!response.ok) {
    throw new Error(`Confluence API error: ${response.status} ${response.statusText}`);
  }

  const data: ConfluenceSearchResult = await response.json();
  const baseUrl = data._links.base || config.baseUrl;

  const results = data.results.map((item) => {
    const htmlContent =
      item.body?.storage?.value || item.body?.view?.value || "";
    const contentText = extractTextFromHtml(htmlContent);

    return {
      id: item.id,
      url: `${baseUrl}${item._links.webui}`,
      title: item.title,
      spaceKey: item.space.key,
      createdAt: "",
      updatedAt: "",
      contentText
    };
  });

  // Cache the results with 24-hour TTL
  try {
    await setCachedSearchResults(query, results as any, 24 * 60 * 60 * 1000, spaceKey);
  } catch (error) {
    console.warn("Cache storage failed:", error);
    // Continue anyway - cache is optional for functionality
  }

  return results;
}

export async function getConfluencePage(pageId: string): Promise<ConfluencePage> {
  const config = await getConfig();
  if (!config) {
    throw new Error("Confluence API not configured");
  }

  const url = `${config.baseUrl}/rest/api/content/${pageId}?expand=body.storage,space,version,history`;

  const headers: HeadersInit = {
    Accept: "application/json"
  };

  if (config.apiToken && config.username) {
    const auth = btoa(`${config.username}:${config.apiToken}`);
    headers.Authorization = `Basic ${auth}`;
  } else if (config.apiToken) {
    headers.Authorization = `Bearer ${config.apiToken}`;
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw new Error(`Confluence API error: ${response.status} ${response.statusText}`);
  }

  const item: ConfluencePageResponse = await response.json();
  const baseUrl = item._links.base || config.baseUrl;
  const htmlContent = item.body?.storage?.value || item.body?.view?.value || "";
  const contentText = extractTextFromHtml(htmlContent);

  return {
    id: item.id,
    url: `${baseUrl}${item._links.webui}`,
    title: item.title,
    spaceKey: item.space.key,
    createdAt: item.history?.createdDate || "",
    updatedAt: item.history?.lastUpdated?.when || "",
    contentText
  };
}

/** Escape CQL string literal: backslash and double-quote so query is safe. */
function escapeCqlString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Build CQL for Confluence search; terms and spaceKeys are escaped. Exported for tests. */
export function buildCQL(query: string, spaceKeys?: string[]): string {
  const terms = query
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `text ~ "${escapeCqlString(t)}"`)
    .join(" AND ");

  if (spaceKeys && spaceKeys.length > 0) {
    const spaceFilter = spaceKeys.map((k) => `space = "${escapeCqlString(k)}"`).join(" OR ");
    return `(${terms}) AND (${spaceFilter})`;
  }

  return terms || "type = page";
}

export async function getConfluenceSpaces(): Promise<ConfluenceSpace[]> {
  const config = await getConfig();
  if (!config) {
    throw new Error("Confluence API not configured");
  }

  try {
    // Try REST API v2 first (newer API)
    const url = new URL(`${config.baseUrl}/rest/api/space`);
    // Limit to 100 spaces (configurable)
    url.searchParams.set("limit", "100");

    const headers: HeadersInit = {
      Accept: "application/json"
    };

    if (config.apiToken && config.username) {
      const auth = btoa(`${config.username}:${config.apiToken}`);
      headers.Authorization = `Basic ${auth}`;
    } else if (config.apiToken) {
      headers.Authorization = `Bearer ${config.apiToken}`;
    }

    const response = await fetch(url.toString(), { headers });

    if (!response.ok) {
      // Fallback: If v2 API fails, try v1
      if (response.status === 404) {
        return await getConfluenceSpacesV1(config, headers);
      }
      throw new Error(`Confluence API error: ${response.status} ${response.statusText}`);
    }

    const data: ConfluenceSpacesResponse = await response.json();

    return data.results.map((space) => ({
      id: space.id?.toString(),
      key: space.key,
      name: space.name,
      type: space.type,
      icon: space.icon?.path ? { path: space.icon.path } : undefined
    }));
  } catch (error) {
    console.error("Failed to fetch Confluence spaces:", error);
    throw error;
  }
}

async function getConfluenceSpacesV1(
  config: ConfluenceConfig,
  headers: HeadersInit
): Promise<ConfluenceSpace[]> {
  // Alternative: Use Confluence v1 API
  // This provides backward compatibility with older Confluence versions
  try {
    const url = `${config.baseUrl}/rest/api/2/space`;
    const response = await fetch(url, { headers });

    if (!response.ok) {
      throw new Error(`Confluence API v1 error: ${response.status}`);
    }

    const data = await response.json();
    return (data.results || []).map((space: any) => ({
      key: space.key,
      name: space.name,
      type: space.type || "global"
    }));
  } catch (error) {
    console.error("Failed to fetch Confluence spaces (v1):", error);
    return [];
  }
}

export async function testConfluenceConnection(): Promise<boolean> {
  const config = await getConfig();
  if (!config) {
    return false;
  }

  try {
    const url = `${config.baseUrl}/rest/api/user/current`;
    const headers: HeadersInit = {
      Accept: "application/json"
    };

    if (config.apiToken && config.username) {
      const auth = btoa(`${config.username}:${config.apiToken}`);
      headers.Authorization = `Basic ${auth}`;
    } else if (config.apiToken) {
      headers.Authorization = `Bearer ${config.apiToken}`;
    }

    const response = await fetch(url, { headers });
    return response.ok;
  } catch {
    return false;
  }
}
