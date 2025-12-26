/**
 * @module help
 * @description Handles the "Help & Features" page functionality for the Magellan extension.
 * This module manages the help page and handles navigation back to the main sidebar.
 *
 * @requires theme.js for theme initialization
 */

import { initializeTheme } from "./theme.js";

/**
 * Initializes the Help & Features page
 * @function
 * @description Sets up event listeners and initializes the page.
 * This function:
 * 1. Initializes the theme
 * 2. Sets up the "Continue" button event listener
 * 3. Handles navigation back to the main sidebar
 *
 * @example
 * // Called when the help page loads
 * document.addEventListener('DOMContentLoaded', initializeHelp);
 */
function initializeHelp() {
  // Initialize theme
  initializeTheme();

  // Set up the "Continue" button
  const continueButton = document.getElementById("continueButton");
  if (continueButton) {
    continueButton.addEventListener("click", () => {
      window.location.href = "sidebar.html";
    });
  }
}

document.addEventListener("DOMContentLoaded", initializeHelp);
