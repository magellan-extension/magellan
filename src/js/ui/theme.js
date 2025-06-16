/**
 * @module theme
 * @description Manages theme initialization and system-wide theme changes for the Magellan extension.
 * This module provides centralized theme management across all extension pages (sidebar, API key page, etc.).
 *
 * Features:
 * - Theme persistence using chrome.storage.local
 * - System theme detection and synchronization
 * - Automatic theme application on page load
 * - Support for light, dark, and system themes
 *
 * Theme Storage:
 * - Key: 'magellan_theme'
 * - Values: 'light' | 'dark' | 'system'
 *
 * Usage:
 * 1. Import and call initializeTheme() in your page's DOMContentLoaded event
 * 2. Theme will be automatically applied based on stored preference
 * 3. System theme changes are automatically detected and applied when in 'system' mode
 *
 * @example
 * // In your page's JavaScript:
 * import { initializeTheme } from './theme.js';
 *
 * document.addEventListener('DOMContentLoaded', () => {
 *   initializeTheme();
 * });
 */

/**
 * Initializes and applies the theme based on stored preferences and system settings.
 * This function:
 * 1. Retrieves the saved theme preference from storage
 * 2. Applies the appropriate theme (light/dark) based on preference
 * 3. Sets up a listener for system theme changes if in 'system' mode
 *
 * The theme is applied by setting the 'data-theme' attribute on the document root:
 * - 'light': Light theme
 * - 'dark': Dark theme
 *
 * @function initializeTheme
 * @async
 * @returns {Promise<void>}
 *
 * @example
 * // Theme will be applied automatically on page load
 * initializeTheme();
 *
 * // Theme can also be re-initialized after changing the preference
 * chrome.storage.local.set({ magellan_theme: 'dark' });
 * initializeTheme();
 */
export function initializeTheme() {
  chrome.storage.local.get(["magellan_theme"], (result) => {
    const savedTheme = result.magellan_theme || "system";
    const root = document.documentElement;
    if (savedTheme === "system") {
      const prefersDark = window.matchMedia(
        "(prefers-color-scheme: dark)"
      ).matches;
      root.setAttribute("data-theme", prefersDark ? "dark" : "light");
    } else {
      root.setAttribute("data-theme", savedTheme);
    }

    // Listen for system theme changes
    if (window.matchMedia) {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const handleThemeChange = (e) => {
        chrome.storage.local.get(["magellan_theme"], (result) => {
          if (result.magellan_theme === "system") {
            root.setAttribute("data-theme", e.matches ? "dark" : "light");
          }
        });
      };
      mediaQuery.addEventListener("change", handleThemeChange);
    }
  });
}

// Auto-initialize theme when the module is loaded
// This ensures the theme is applied as soon as possible, even before DOMContentLoaded
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeTheme);
} else {
  initializeTheme();
}
