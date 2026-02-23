/**
 * Confluence Spaces Storage & Management
 * 
 * Manages Confluence space selection and caching at the user level.
 * Stores space list and selected space preference in Chrome storage.
 */

import type { ConfluenceSpace } from "../api/confluence";

// Storage keys
const SPACES_CACHE_KEY = "confluence_spaces_cache";
const SELECTED_SPACE_KEY = "confluence_selected_space";
const SPACES_CACHE_TTL_KEY = "confluence_spaces_cache_ttl";

// Default cache TTL: 24 hours
export const SPACES_CACHE_TTL = 24 * 60 * 60 * 1000;

/**
 * Get cached Confluence spaces list
 * Returns null if cache expired or not found
 */
export async function getCachedSpaces(): Promise<ConfluenceSpace[] | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      [SPACES_CACHE_KEY, SPACES_CACHE_TTL_KEY],
      (result) => {
        const spaces = result[SPACES_CACHE_KEY];
        const cacheTtl = result[SPACES_CACHE_TTL_KEY];

        if (!spaces || !cacheTtl) {
          resolve(null);
          return;
        }

        // Check if cache is expired
        if (Date.now() > cacheTtl) {
          // Cache expired, delete it
          chrome.storage.local.remove([SPACES_CACHE_KEY, SPACES_CACHE_TTL_KEY]);
          resolve(null);
          return;
        }

        resolve(spaces as ConfluenceSpace[]);
      }
    );
  });
}

/**
 * Cache Confluence spaces list in chrome.storage
 * Default cache duration: 24 hours
 */
export async function setCachedSpaces(
  spaces: ConfluenceSpace[],
  ttlMs: number = SPACES_CACHE_TTL
): Promise<void> {
  return new Promise((resolve, reject) => {
    const expirationTime = Date.now() + ttlMs;

    chrome.storage.local.set(
      {
        [SPACES_CACHE_KEY]: spaces,
        [SPACES_CACHE_TTL_KEY]: expirationTime
      },
      () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      }
    );
  });
}

/**
 * Get currently selected space key
 * Returns null if "All spaces" is selected
 */
export async function getSelectedSpace(): Promise<string | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get([SELECTED_SPACE_KEY], (result) => {
      resolve(result[SELECTED_SPACE_KEY] || null);
    });
  });
}

/**
 * Set selected space key
 * Pass null or empty string for "All spaces"
 */
export async function setSelectedSpace(spaceKey: string | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (spaceKey === null || spaceKey === "") {
      // Clear selection (All spaces)
      chrome.storage.local.remove([SELECTED_SPACE_KEY], () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    } else {
      chrome.storage.local.set(
        { [SELECTED_SPACE_KEY]: spaceKey },
        () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve();
          }
        }
      );
    }
  });
}

/**
 * Get space statistics
 */
export async function getSpaceStats(): Promise<{
  totalSpaces: number;
  selectedSpace: string | null;
  cacheExpired: boolean;
}> {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      [SPACES_CACHE_KEY, SPACES_CACHE_TTL_KEY, SELECTED_SPACE_KEY],
      (result) => {
        const spaces = result[SPACES_CACHE_KEY] as ConfluenceSpace[] | undefined;
        const cacheTtl = result[SPACES_CACHE_TTL_KEY] as number | undefined;
        const selectedSpace = result[SELECTED_SPACE_KEY] as string | undefined;

        const totalSpaces = spaces?.length ?? 0;
        const cacheExpired = !cacheTtl || Date.now() > cacheTtl;
        const selected = selectedSpace || null;

        resolve({
          totalSpaces,
          selectedSpace: selected,
          cacheExpired
        });
      }
    );
  });
}

/**
 * Clear all spaces cache data
 */
export async function clearSpacesCache(): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(
      [SPACES_CACHE_KEY, SPACES_CACHE_TTL_KEY],
      () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      }
    );
  });
}

/**
 * Check if space selection is valid (space exists)
 */
export async function validateSpaceSelection(
  spaceKey: string | null
): Promise<boolean> {
  if (!spaceKey) {
    // All spaces is always valid
    return true;
  }

  const spaces = await getCachedSpaces();
  if (!spaces) {
    // Can't validate without cached spaces
    return false;
  }

  return spaces.some((s) => s.key === spaceKey);
}

/**
 * Get space info by key
 */
export async function getSpaceByKey(
  spaceKey: string
): Promise<ConfluenceSpace | null> {
  const spaces = await getCachedSpaces();
  if (!spaces) {
    return null;
  }

  return spaces.find((s) => s.key === spaceKey) || null;
}

/**
 * Get all global spaces (non-personal)
 */
export async function getGlobalSpaces(): Promise<ConfluenceSpace[]> {
  const spaces = await getCachedSpaces();
  if (!spaces) {
    return [];
  }

  return spaces.filter((s) => s.type === "global");
}

/**
 * Get all spaces of a specific type
 */
export async function getSpacesByType(
  type: "global" | "personal"
): Promise<ConfluenceSpace[]> {
  const spaces = await getCachedSpaces();
  if (!spaces) {
    return [];
  }

  return spaces.filter((s) => s.type === type);
}
