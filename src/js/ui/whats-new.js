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

/** @constant {string} Storage key for tracking if the user has seen the what's new screen */
const WHATS_NEW_SEEN_KEY = "magellan_whats_new_seen";

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
    await chrome.storage.local.set({ [WHATS_NEW_SEEN_KEY]: true });

    console.log("What's new screen marked as seen, navigating to sidebar...");

    // Navigate to the sidebar
    setTimeout(() => {
      try {
        // Check if we're in a popup context
        if (window.location.search.includes("popup=true") || window.opener) {
          window.close();
        } else {
          window.location.href = "sidebar.html";
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
