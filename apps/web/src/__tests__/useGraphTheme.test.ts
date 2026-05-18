// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGraphTheme, type GraphThemeColors } from '../pages/graph/useGraphTheme';
import graphCanvasSource from '../pages/graph/GraphCanvas.tsx?raw';

type TestThemeName = 'light' | 'dark';

const CSS_VALUES: Record<TestThemeName, GraphThemeColors> = {
  light: {
    canvasBg: '#f5f5f5',
    background: '#ffffff',
    textPrimary: 'rgba(0, 0, 0, 0.88)',
    textSecondary: 'rgba(0, 0, 0, 0.6)',
    textTertiary: 'rgba(0, 0, 0, 0.38)',
    border: 'rgba(0, 0, 0, 0.08)',
    surface: '#ffffff',
    primary: '#00b96b',
    primaryMute: '#00b96b33',
  },
  dark: {
    canvasBg: '#333333',
    background: '#181818',
    textPrimary: 'rgba(255, 255, 245, 0.9)',
    textSecondary: 'rgba(235, 235, 245, 0.6)',
    textTertiary: 'rgba(235, 235, 245, 0.38)',
    border: 'rgba(255, 255, 255, 0.1)',
    surface: '#222222',
    primary: '#00b96b',
    primaryMute: '#00b96b33',
  },
};

const CSS_VARIABLES: Record<string, keyof GraphThemeColors> = {
  '--color-background-mute': 'canvasBg',
  '--color-background': 'background',
  '--color-text-1': 'textPrimary',
  '--color-text-2': 'textSecondary',
  '--color-text-3': 'textTertiary',
  '--color-border': 'border',
  '--color-surface': 'surface',
  '--color-primary': 'primary',
  '--color-primary-mute': 'primaryMute',
};

describe('useGraphTheme', () => {
  beforeEach(() => {
    document.documentElement.dataset.theme = 'light';
    vi.spyOn(window, 'getComputedStyle').mockImplementation(() => {
      const themeName: TestThemeName = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
      const values = CSS_VALUES[themeName];

      return {
        getPropertyValue: (propertyName: string) => {
          const key = CSS_VARIABLES[propertyName];
          return key === undefined ? '' : values[key];
        },
      } as CSSStyleDeclaration;
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    delete document.documentElement.dataset.theme;
  });

  it('returns all required theme color fields', () => {
    const { result } = renderHook(() => useGraphTheme());

    expect(result.current).toEqual(CSS_VALUES.light);
    expect(Object.keys(result.current).sort()).toEqual([
      'background',
      'border',
      'canvasBg',
      'primary',
      'primaryMute',
      'surface',
      'textPrimary',
      'textSecondary',
      'textTertiary',
    ]);
  });

  it('re-reads CSS variables when the data-theme attribute changes', async () => {
    const { result } = renderHook(() => useGraphTheme());

    expect(result.current.canvasBg).toBe('#f5f5f5');

    act(() => {
      document.documentElement.dataset.theme = 'dark';
    });

    await waitFor(() => {
      expect(result.current).toEqual(CSS_VALUES.dark);
    });
  });
});

describe('GraphCanvas theme source', () => {
  it('does not hardcode background, border, or text label colors', () => {
    const sourceWithoutAllowedConstants = graphCanvasSource
      .replace(/const NODE_TYPE_COLORS[\s\S]*?};/, '')
      .replace(/const DEFAULT_NODE_COLOR = '#94a3b8';/, '')
      .replace(/'#fab387'/g, '');

    expect(sourceWithoutAllowedConstants).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(sourceWithoutAllowedConstants).not.toContain('rgba(30, 30, 46, 0.9)');
    expect(sourceWithoutAllowedConstants).not.toContain('rgba(100, 116, 139, 0.45)');
  });
});
