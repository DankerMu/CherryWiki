import { vi } from 'vitest';
import { i18nReady } from '../i18n';

// Ensure i18n is fully initialized before tests run.
await i18nReady;

// antd requires window.matchMedia, which jsdom does not provide.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  configurable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// antd also uses getComputedStyle which jsdom partially supports.
// Ensure it doesn't throw on missing elements.
if (typeof window.getComputedStyle === 'undefined') {
  Object.defineProperty(window, 'getComputedStyle', {
    value: () => ({
      getPropertyValue: () => '',
    }),
  });
}
