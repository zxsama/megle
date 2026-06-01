const LIBRARY_GRID_PREFERENCES_STORAGE_KEY = "megle.library.grid-preferences";

export interface LibraryGridPreferences {
  folderEdgeShadowAlpha: number;
  folderTileGap: number;
  folderTileLabelHeight: number;
  tileGap: number;
  tileLabelHeight: number;
}

export const DEFAULT_LIBRARY_GRID_PREFERENCES: LibraryGridPreferences = {
  folderEdgeShadowAlpha: 25,
  folderTileGap: 7,
  folderTileLabelHeight: 17,
  tileGap: 7,
  tileLabelHeight: 17
};

export const LIBRARY_GRID_PREFERENCE_LIMITS = {
  folderEdgeShadowAlpha: { min: 0, max: 75, step: 1 },
  folderTileGap: { min: 4, max: 20, step: 1 },
  folderTileLabelHeight: { min: 14, max: 40, step: 1 },
  tileGap: { min: 4, max: 20, step: 1 },
  tileLabelHeight: { min: 14, max: 40, step: 1 }
} as const;

export function readStoredLibraryGridPreferences(): LibraryGridPreferences {
  try {
    const stored = window.localStorage.getItem(LIBRARY_GRID_PREFERENCES_STORAGE_KEY);
    if (!stored) {
      return DEFAULT_LIBRARY_GRID_PREFERENCES;
    }
    const parsed = JSON.parse(stored) as Partial<LibraryGridPreferences> | null;
    return normalizeLibraryGridPreferences(parsed ?? {});
  } catch {
    return DEFAULT_LIBRARY_GRID_PREFERENCES;
  }
}

export function storeLibraryGridPreferences(value: LibraryGridPreferences) {
  try {
    window.localStorage.setItem(
      LIBRARY_GRID_PREFERENCES_STORAGE_KEY,
      JSON.stringify(normalizeLibraryGridPreferences(value))
    );
  } catch {
    // Ignore storage failures in hardened/browser-restricted environments.
  }
}

export function normalizeLibraryGridPreferences(
  value: Partial<LibraryGridPreferences>
): LibraryGridPreferences {
  const tileGap = clampPreference(
    value.tileGap,
    LIBRARY_GRID_PREFERENCE_LIMITS.tileGap.min,
    LIBRARY_GRID_PREFERENCE_LIMITS.tileGap.max,
    DEFAULT_LIBRARY_GRID_PREFERENCES.tileGap
  );
  const tileLabelHeight = clampPreference(
    value.tileLabelHeight,
    LIBRARY_GRID_PREFERENCE_LIMITS.tileLabelHeight.min,
    LIBRARY_GRID_PREFERENCE_LIMITS.tileLabelHeight.max,
    DEFAULT_LIBRARY_GRID_PREFERENCES.tileLabelHeight
  );
  return {
    folderEdgeShadowAlpha: clampPreference(
      value.folderEdgeShadowAlpha,
      LIBRARY_GRID_PREFERENCE_LIMITS.folderEdgeShadowAlpha.min,
      LIBRARY_GRID_PREFERENCE_LIMITS.folderEdgeShadowAlpha.max,
      DEFAULT_LIBRARY_GRID_PREFERENCES.folderEdgeShadowAlpha
    ),
    folderTileGap: clampPreference(
      value.folderTileGap,
      LIBRARY_GRID_PREFERENCE_LIMITS.folderTileGap.min,
      LIBRARY_GRID_PREFERENCE_LIMITS.folderTileGap.max,
      tileGap
    ),
    folderTileLabelHeight: clampPreference(
      value.folderTileLabelHeight,
      LIBRARY_GRID_PREFERENCE_LIMITS.folderTileLabelHeight.min,
      LIBRARY_GRID_PREFERENCE_LIMITS.folderTileLabelHeight.max,
      tileLabelHeight
    ),
    tileGap,
    tileLabelHeight
  };
}

function clampPreference(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number
) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}
