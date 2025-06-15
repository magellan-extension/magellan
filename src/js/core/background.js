/**
 * @fileoverview Background Service Worker for Magellan
 * @description Manages the extension's background processes and side panel behavior.
 * This service worker runs in the background and handles extension-level operations
 * such as side panel management and lifecycle events.
 *
 * @requires chrome.sidePanel API
 */

/**
 * Configures the side panel behavior for the extension.
 * This sets up the side panel to open when the extension icon is clicked.
 *
 * @async
 * @function
 * @throws {Error} If the side panel configuration fails
 *
 * @example
 * // The side panel will open when the user clicks the extension icon
 * chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
 */
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error("Failed to set side panel behavior:", error));
