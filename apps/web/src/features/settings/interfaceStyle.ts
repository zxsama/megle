import { useCallback, useEffect, useMemo, useState } from "react";

export const INTERFACE_STYLE_STORAGE_KEY = "megle.interfaceStyle";

export interface InterfaceStylePreference {
  glassBlur: number;
  pointerGlowBrightness: number;
  edgeHighlightBrightness: number;
}

export const DEFAULT_INTERFACE_STYLE: InterfaceStylePreference = {
  glassBlur: 1,
  pointerGlowBrightness: 1.45,
  edgeHighlightBrightness: 6.5
};

export const INTERFACE_STYLE_LIMITS = {
  glassBlur: { min: 0, max: 2, step: 0.05 },
  pointerGlowBrightness: { min: 0, max: 2, step: 0.05 },
  edgeHighlightBrightness: { min: 0, max: 8, step: 0.25 }
} as const;

export type InterfaceStylePatch = Partial<InterfaceStylePreference>;

export interface InterfaceStyleController {
  value: InterfaceStylePreference;
  limits: typeof INTERFACE_STYLE_LIMITS;
  setInterfaceStyle: (patch: InterfaceStylePatch) => void;
  resetInterfaceStyle: () => void;
}

export function normalizeInterfaceStyle(input: unknown): InterfaceStylePreference {
  const source = isRecord(input) ? input : {};
  return {
    glassBlur: clampNumber(
      source.glassBlur,
      INTERFACE_STYLE_LIMITS.glassBlur,
      DEFAULT_INTERFACE_STYLE.glassBlur
    ),
    pointerGlowBrightness: clampNumber(
      source.pointerGlowBrightness,
      INTERFACE_STYLE_LIMITS.pointerGlowBrightness,
      DEFAULT_INTERFACE_STYLE.pointerGlowBrightness
    ),
    edgeHighlightBrightness: clampNumber(
      source.edgeHighlightBrightness,
      INTERFACE_STYLE_LIMITS.edgeHighlightBrightness,
      DEFAULT_INTERFACE_STYLE.edgeHighlightBrightness
    )
  };
}

export function readInterfaceStyle(storage: Storage | undefined = defaultStorage()) {
  if (!storage) return DEFAULT_INTERFACE_STYLE;
  try {
    const raw = storage.getItem(INTERFACE_STYLE_STORAGE_KEY);
    return raw ? normalizeInterfaceStyle(JSON.parse(raw)) : DEFAULT_INTERFACE_STYLE;
  } catch {
    return DEFAULT_INTERFACE_STYLE;
  }
}

export function writeInterfaceStyle(
  value: InterfaceStylePreference,
  storage: Storage | undefined = defaultStorage()
) {
  if (!storage) return;
  storage.setItem(INTERFACE_STYLE_STORAGE_KEY, JSON.stringify(normalizeInterfaceStyle(value)));
}

export function interfaceStyleToCssVariables(
  value: InterfaceStylePreference
): Record<string, string> {
  const normalized = normalizeInterfaceStyle(value);
  return {
    "--glass-blur": `${roundCssNumber(26 * normalized.glassBlur)}px`,
    "--glass-elevated-blur": `${roundCssNumber(34 * normalized.glassBlur)}px`,
    "--glass-control-blur": `${roundCssNumber(18 * normalized.glassBlur)}px`,
    "--glass-pointer-glow-brightness": String(
      roundCssNumber(normalized.pointerGlowBrightness)
    ),
    "--glass-edge-highlight-brightness": String(
      roundCssNumber(normalized.edgeHighlightBrightness)
    )
  };
}

export function applyInterfaceStyleVariables(
  value: InterfaceStylePreference,
  target: HTMLElement = document.documentElement
) {
  const variables = interfaceStyleToCssVariables(value);
  for (const [name, cssValue] of Object.entries(variables)) {
    target.style.setProperty(name, cssValue);
  }
}

export function useInterfaceStyle(): InterfaceStyleController {
  const [value, setValue] = useState<InterfaceStylePreference>(() => readInterfaceStyle());

  useEffect(() => {
    applyInterfaceStyleVariables(value);
    writeInterfaceStyle(value);
  }, [value]);

  const setInterfaceStyle = useCallback((patch: InterfaceStylePatch) => {
    setValue((current) => normalizeInterfaceStyle({ ...current, ...patch }));
  }, []);

  const resetInterfaceStyle = useCallback(() => {
    setValue(DEFAULT_INTERFACE_STYLE);
  }, []);

  return useMemo(
    () => ({ value, limits: INTERFACE_STYLE_LIMITS, setInterfaceStyle, resetInterfaceStyle }),
    [resetInterfaceStyle, setInterfaceStyle, value]
  );
}

function defaultStorage(): Storage | undefined {
  return typeof window === "undefined" ? undefined : window.localStorage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function clampNumber(value: unknown, limits: { min: number; max: number }, fallback: number) {
  const number = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(limits.max, Math.max(limits.min, number));
}

function roundCssNumber(value: number) {
  return Math.round(value * 1000) / 1000;
}
