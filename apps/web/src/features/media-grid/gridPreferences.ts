const LIBRARY_GRID_PREFERENCES_STORAGE_KEY = "megle.library.grid-preferences";

export interface LibraryGridPreferences {
  tileGap: number;
  tileLabelHeight: number;
}

export const DEFAULT_LIBRARY_GRID_PREFERENCES: LibraryGridPreferences = {
  tileGap: 7,
  tileLabelHeight: 17
};

export const LIBRARY_GRID_PREFERENCE_LIMITS = {
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
  return {
    tileGap: clampPreference(
      value.tileGap,
      LIBRARY_GRID_PREFERENCE_LIMITS.tileGap.min,
      LIBRARY_GRID_PREFERENCE_LIMITS.tileGap.max,
      DEFAULT_LIBRARY_GRID_PREFERENCES.tileGap
    ),
    tileLabelHeight: clampPreference(
      value.tileLabelHeight,
      LIBRARY_GRID_PREFERENCE_LIMITS.tileLabelHeight.min,
      LIBRARY_GRID_PREFERENCE_LIMITS.tileLabelHeight.max,
      DEFAULT_LIBRARY_GRID_PREFERENCES.tileLabelHeight
    )
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
