import { useEffect, useState } from 'react';

export type GraphThemeColors = {
  canvasBg: string;
  background: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  border: string;
  surface: string;
  primary: string;
  primaryMute: string;
};

const FALLBACK_GRAPH_THEME: GraphThemeColors = {
  canvasBg: '#f5f5f5',
  background: '#ffffff',
  textPrimary: 'rgba(0, 0, 0, 0.88)',
  textSecondary: 'rgba(0, 0, 0, 0.6)',
  textTertiary: 'rgba(0, 0, 0, 0.38)',
  border: 'rgba(0, 0, 0, 0.08)',
  surface: '#ffffff',
  primary: '#00b96b',
  primaryMute: '#00b96b33',
};

const CSS_VARIABLES: Record<keyof GraphThemeColors, string> = {
  canvasBg: '--color-background-mute',
  background: '--color-background',
  textPrimary: '--color-text-1',
  textSecondary: '--color-text-2',
  textTertiary: '--color-text-3',
  border: '--color-border',
  surface: '--color-surface',
  primary: '--color-primary',
  primaryMute: '--color-primary-mute',
};

function readGraphThemeColors(): GraphThemeColors {
  if (typeof document === 'undefined' || typeof getComputedStyle === 'undefined') {
    return FALLBACK_GRAPH_THEME;
  }

  const styles = getComputedStyle(document.documentElement);

  return Object.fromEntries(
    Object.entries(CSS_VARIABLES).map(([key, variableName]) => {
      const value = styles.getPropertyValue(variableName).trim();
      return [key, value.length > 0 ? value : FALLBACK_GRAPH_THEME[key as keyof GraphThemeColors]];
    }),
  ) as GraphThemeColors;
}

export function useGraphTheme(): GraphThemeColors {
  const [colors, setColors] = useState<GraphThemeColors>(() => readGraphThemeColors());

  useEffect(() => {
    setColors(readGraphThemeColors());

    if (typeof MutationObserver === 'undefined') {
      return undefined;
    }

    const observer = new MutationObserver(() => {
      setColors(readGraphThemeColors());
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    return () => observer.disconnect();
  }, []);

  return colors;
}
