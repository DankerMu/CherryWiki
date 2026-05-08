import { ConfigProvider } from 'antd';
import enUS from 'antd/locale/en_US';
import zhCN from 'antd/locale/zh_CN';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import i18n, { LANGUAGE_STORAGE_KEY, normalizeLanguage, type SupportedLanguage } from '../i18n';
import { darkThemeConfig, lightThemeConfig } from './themeConfig';

export type ThemeMode = 'light' | 'dark';

type ThemeContextValue = {
  themeMode: ThemeMode;
  language: SupportedLanguage;
  setThemeMode: (mode: ThemeMode) => void;
  toggleTheme: () => void;
  setLanguage: (language: SupportedLanguage) => void;
};

type ThemeProviderProps = {
  children: ReactNode;
};

const THEME_STORAGE_KEY = 'cherrywiki.theme';
const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => getInitialThemeMode());
  const [language, setLanguageState] = useState<SupportedLanguage>(() => normalizeLanguage(i18n.language));
  const [hasStoredThemePreference, setHasStoredThemePreference] = useState(() => readStoredThemeMode() !== null);

  const setThemeMode = useCallback((mode: ThemeMode) => {
    setThemeModeState(mode);
    setHasStoredThemePreference(true);
    safeSetStorage(THEME_STORAGE_KEY, mode);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeModeState((current) => {
      const next = current === 'dark' ? 'light' : 'dark';
      setHasStoredThemePreference(true);
      safeSetStorage(THEME_STORAGE_KEY, next);
      return next;
    });
  }, []);

  const setLanguage = useCallback((nextLanguage: SupportedLanguage) => {
    const normalized = normalizeLanguage(nextLanguage);
    setLanguageState(normalized);
    safeSetStorage(LANGUAGE_STORAGE_KEY, normalized);
    void i18n.changeLanguage(normalized).catch(() => undefined);
  }, []);

  useEffect(() => {
    const handleLanguageChanged = (nextLanguage: string) => {
      setLanguageState(normalizeLanguage(nextLanguage));
    };

    i18n.on('languageChanged', handleLanguageChanged);

    return () => {
      i18n.off('languageChanged', handleLanguageChanged);
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
  }, [themeMode]);

  useEffect(() => {
    if (hasStoredThemePreference || typeof window.matchMedia !== 'function') {
      return;
    }

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (event: MediaQueryListEvent) => {
      setThemeModeState(event.matches ? 'dark' : 'light');
    };

    try {
      media.addEventListener('change', handleChange);
    } catch {
      return;
    }

    return () => {
      try {
        media.removeEventListener('change', handleChange);
      } catch {
        // Ignore browser compatibility failures during cleanup.
      }
    };
  }, [hasStoredThemePreference]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      themeMode,
      language,
      setThemeMode,
      toggleTheme,
      setLanguage,
    }),
    [language, setLanguage, setThemeMode, themeMode, toggleTheme],
  );

  return (
    <ThemeContext.Provider value={value}>
      <ConfigProvider
        locale={language === 'zh-CN' ? zhCN : enUS}
        theme={themeMode === 'dark' ? darkThemeConfig : lightThemeConfig}
      >
        {children}
      </ConfigProvider>
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within ThemeProvider');
  }

  return context;
}

function getInitialThemeMode(): ThemeMode {
  const stored = readStoredThemeMode();
  if (stored !== null) {
    return stored;
  }

  if (typeof window.matchMedia === 'function') {
    try {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  }

  return 'light';
}

function readStoredThemeMode(): ThemeMode | null {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'dark' || stored === 'light' ? stored : null;
  } catch {
    return null;
  }
}

function safeSetStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Persisting preferences is best effort.
  }
}
