/**
 * Telegram Mini App (TMA) Lifecycle & Viewport Hook
 * Adheres strictly to ui-psychology-tma invariants.
 */

import { useEffect, useState, useCallback } from 'react';
import { TelegramWebApp } from '../types/telegram';

export interface TelegramState {
  isTMA: boolean;
  user?: {
    id: number;
    firstName: string;
    username?: string;
  };
  colorScheme: 'light' | 'dark';
  viewportHeight: number;
  viewportStableHeight: number;
  isExpanded: boolean;
}

export function useTelegramWebApp() {
  const [tgState, setTgState] = useState<TelegramState>(() => {
    const webApp = typeof window !== 'undefined' ? window.Telegram?.WebApp : undefined;
    const isTMA = !!(webApp && webApp.initData);
    const colorScheme = webApp?.colorScheme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

    return {
      isTMA,
      user: webApp?.initDataUnsafe?.user
        ? {
            id: webApp.initDataUnsafe.user.id,
            firstName: webApp.initDataUnsafe.user.first_name,
            username: webApp.initDataUnsafe.user.username,
          }
        : undefined,
      colorScheme,
      viewportHeight: webApp?.viewportHeight || (typeof window !== 'undefined' ? window.innerHeight : 800),
      viewportStableHeight: webApp?.viewportStableHeight || (typeof window !== 'undefined' ? window.innerHeight : 800),
      isExpanded: webApp?.isExpanded || false,
    };
  });

  // Synchronize CSS variables and root attributes with Telegram theme
  const applyTheme = useCallback((webApp?: TelegramWebApp) => {
    const root = document.documentElement;
    const isDark = webApp ? webApp.colorScheme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;

    if (isDark) {
      root.classList.add('dark');
      root.setAttribute('data-theme', 'dark');
    } else {
      root.classList.remove('dark');
      root.setAttribute('data-theme', 'light');
    }

    if (webApp && webApp.themeParams) {
      const tp = webApp.themeParams;
      if (tp.bg_color) root.style.setProperty('--tg-theme-bg-color', tp.bg_color);
      if (tp.text_color) root.style.setProperty('--tg-theme-text-color', tp.text_color);
      if (tp.secondary_bg_color) root.style.setProperty('--tg-theme-secondary-bg-color', tp.secondary_bg_color);
      if (tp.hint_color) root.style.setProperty('--tg-theme-hint-color', tp.hint_color);
      if (tp.button_color) root.style.setProperty('--tg-theme-button-color', tp.button_color);
      if (tp.button_text_color) root.style.setProperty('--tg-theme-button-text-color', tp.button_text_color);
      if (tp.link_color) root.style.setProperty('--tg-theme-link-color', tp.link_color);
    }
  }, []);

  useEffect(() => {
    const webApp = window.Telegram?.WebApp;
    if (!webApp) {
      applyTheme();
      return;
    }

    // 1. Initial lifecycle initialization
    try {
      webApp.ready();
      webApp.expand();
    } catch (e) {
      console.warn('Telegram WebApp ready/expand error:', e);
    }

    applyTheme(webApp);

    // 2. Viewport & theme change listeners
    const handleViewportChange = () => {
      setTgState((prev) => ({
        ...prev,
        viewportHeight: webApp.viewportHeight,
        viewportStableHeight: webApp.viewportStableHeight,
        isExpanded: webApp.isExpanded,
      }));
    };

    const handleThemeChange = () => {
      applyTheme(webApp);
      setTgState((prev) => ({
        ...prev,
        colorScheme: webApp.colorScheme,
      }));
    };

    webApp.onEvent('viewportChanged', handleViewportChange);
    webApp.onEvent('themeChanged', handleThemeChange);

    return () => {
      webApp.offEvent('viewportChanged', handleViewportChange);
      webApp.offEvent('themeChanged', handleThemeChange);
    };
  }, [applyTheme]);

  // Haptic feedback wrappers
  const haptic = {
    impact: (style: 'light' | 'medium' | 'heavy' = 'light') => {
      try {
        window.Telegram?.WebApp?.HapticFeedback?.impactOccurred(style);
      } catch {
        // Fallback or desktop: no-op
      }
    },
    notification: (type: 'success' | 'warning' | 'error') => {
      try {
        window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred(type);
      } catch {
        // Fallback: no-op
      }
    },
    selection: () => {
      try {
        window.Telegram?.WebApp?.HapticFeedback?.selectionChanged();
      } catch {
        // Fallback: no-op
      }
    },
  };

  // Safe closing confirmation for in-flight operations
  const setClosingConfirmation = (enabled: boolean) => {
    try {
      if (enabled) {
        window.Telegram?.WebApp?.enableClosingConfirmation();
      } else {
        window.Telegram?.WebApp?.disableClosingConfirmation();
      }
    } catch {
      // No-op
    }
  };

  return {
    ...tgState,
    webApp: typeof window !== 'undefined' ? window.Telegram?.WebApp : undefined,
    haptic,
    setClosingConfirmation,
  };
}
