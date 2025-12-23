/**
 * @module whats-new
 * @description Handles the "What's New" screen functionality for the Magellan extension.
 * This module manages the display of new features and updates to users.
 *
 * Features:
 * - Shows new features and improvements
 * - Marks the screen as seen to prevent re-display
 * - Handles navigation back to the main sidebar
 *
 * @requires chrome.storage API for persistence
 * @requires theme.js for theme initialization
 */

import { initializeTheme } from "./theme.js";

/** @constant {string} Storage key for the API key */
const API_KEY_STORAGE_KEY = "magellan_openrouter_api_key";

/** @constant {string} Storage key for tracking if the user has seen the what's new screen */
const WHATS_NEW_SEEN_KEY = "magellan_whats_new_seen";

/** @constant {string} Version of the what's new page - increment this to show it to all users again */
const WHATS_NEW_VERSION = "2.0.0";

/** @constant {string} Storage key for tracking the what's new version the user has seen */
const WHATS_NEW_VERSION_KEY = "magellan_whats_new_version";

/** @constant {string} Storage key for tracking if user has completed one-time setup */
const SETUP_COMPLETE_KEY = "magellan_setup_complete";

/**
 * Initializes the "What's New" screen
 * @async
 * @function
 * @description Sets up event listeners and initializes the screen.
 * This function:
 * 1. Initializes the theme
 * 2. Sets up the "Get Started" button event listener
 * 3. Handles navigation back to the main sidebar
 *
 * @example
 * // Called when the what's new page loads
 * document.addEventListener('DOMContentLoaded', initializeWhatsNew);
 */
async function initializeWhatsNew() {
  // Initialize theme
  initializeTheme();

  // Set up the "Get Started" button
  const getStartedButton = document.getElementById("getStartedButton");
  if (getStartedButton) {
    getStartedButton.addEventListener("click", handleGetStarted);
  }
}

/**
 * Handles the "Get Started" button click
 * @async
 * @function
 * @description Marks the what's new screen as seen and navigates to the sidebar.
 * This function:
 * 1. Marks the what's new screen as seen in storage
 * 2. Navigates to the main sidebar
 * 3. Handles different navigation contexts (popup vs side panel)
 *
 * @example
 * // Called when user clicks "Get Started"
 * handleGetStarted();
 */
async function handleGetStarted() {
  try {
    await chrome.storage.local.set({
      [WHATS_NEW_SEEN_KEY]: true,
      [WHATS_NEW_VERSION_KEY]: WHATS_NEW_VERSION,
    });

    console.log("What's new screen marked as seen, checking setup status...");

    // Check if user needs to complete setup (API key and model selection)
    const {
      [API_KEY_STORAGE_KEY]: apiKey,
      [SETUP_COMPLETE_KEY]: setupComplete,
    } = await chrome.storage.local.get([
      API_KEY_STORAGE_KEY,
      SETUP_COMPLETE_KEY,
    ]);

    // Navigate based on setup status
    setTimeout(() => {
      try {
        // Check if we're in a popup context
        if (window.location.search.includes("popup=true") || window.opener) {
          window.close();
        } else {
          // If no API key or setup not complete, go to API key page
          if (!apiKey || !setupComplete) {
            window.location.href = "api-key.html";
          } else {
            window.location.href = "sidebar.html";
          }
        }
      } catch (error) {
        console.error("Error during navigation:", error);
        window.location.reload();
      }
    }, 200);
  } catch (error) {
    console.error("Error marking what's new as seen:", error);
    window.location.href = "sidebar.html";
  }
}

document.addEventListener("DOMContentLoaded", initializeWhatsNew);
