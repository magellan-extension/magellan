/**
 * @fileoverview API Key Management for Magellan
 * @description Handles the storage, validation, and management of the Google Gemini API key.
 * This module provides functionality for validating API keys, storing them securely,
 * and managing the API key UI interface.
 *
 * @requires chrome.storage API
 * @requires GoogleGenAI class
 */

/** @constant {string} Storage key for the API key in Chrome's local storage */
const API_KEY_STORAGE_KEY = "magellan_gemini_api_key";

/**
 * Validates a Google Gemini API key
 * @param {string} key - The API key to validate
 * @returns {Promise<{isValid: boolean, error: string|null}>} Validation result
 * @throws {Error} If validation process fails
 *
 * @example
 * const result = await validateApiKey('AI...');
 * if (result.isValid) {
 *   console.log('API key is valid');
 * } else {
 *   console.error(result.error);
 * }
 */
async function validateApiKey(key) {
  if (!key || !key.startsWith("AI") || key.length !== 39) {
    return {
      isValid: false,
      error:
        'Invalid API key format. Keys should start with "AI" and be 39 characters long.',
    };
  }

  try {
    const testAi = new GoogleGenAI({ apiKey: key });

    const testPrompt = "Say 'test' if you can read this.";
    const result = await testAi.generateContent(testPrompt);

    if (!result || !result.text) {
      return {
        isValid: false,
        error: "API key validation failed: No response received",
      };
    }

    return {
      isValid: true,
      error: null,
    };
  } catch (error) {
    console.error("API key validation error:", error);
    return {
      isValid: false,
      error: `API key validation failed: ${error.message || "Unknown error"}`,
    };
  }
}

/**
 * Displays a status message for API key operations
 * @param {string} message - The message to display
 * @param {boolean} [isError=false] - Whether the message is an error
 *
 * @example
 * showApiKeyStatus('API key saved successfully');
 * showApiKeyStatus('Invalid API key', true);
 */
function showApiKeyStatus(message, isError = false) {
  const statusEl = document.getElementById("apiKeyStatus");
  statusEl.textContent = message;
  statusEl.className = `api-key-status visible ${
    isError ? "error" : "success"
  }`;
  setTimeout(() => {
    statusEl.className = "api-key-status";
  }, 3000);
}

/**
 * Initializes the API key management interface
 * @async
 * @function
 *
 * This function:
 * 1. Sets up event listeners for the API key form
 * 2. Loads any existing API key from storage
 * 3. Handles API key validation and storage
 * 4. Manages the UI state during these operations
 *
 * @example
 * // Called when the API key page loads
 * document.addEventListener('DOMContentLoaded', initializeApiKey);
 */
async function initializeApiKey() {
  const apiKeyInput = document.getElementById("apiKeyInput");
  const saveButton = document.getElementById("saveApiKey");
  const backButton = document.getElementById("backToPopup");

  const result = await chrome.storage.local.get([API_KEY_STORAGE_KEY]);
  if (result[API_KEY_STORAGE_KEY]) {
    apiKeyInput.value = result[API_KEY_STORAGE_KEY];
  }

  /**
   * Handles the API key save operation
   * @async
   * @function
   */
  saveButton.addEventListener("click", async () => {
    const apiKey = apiKeyInput.value.trim();

    if (!apiKey) {
      showApiKeyStatus("Please enter an API key", true);
      return;
    }

    saveButton.disabled = true;
    saveButton.textContent = "Validating...";

    try {
      const validation = await validateApiKey(apiKey);

      if (!validation.isValid) {
        showApiKeyStatus(validation.error, true);
        return;
      }

      await chrome.storage.local.set({ [API_KEY_STORAGE_KEY]: apiKey });
      showApiKeyStatus("API key saved successfully");

      const views = await chrome.extension.getViews({ type: "popup" });
      if (views.length > 0) {
        views[0].window.ai = new GoogleGenAI({ apiKey });
      }
    } catch (error) {
      showApiKeyStatus("Failed to validate API key: " + error.message, true);
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = "Save";
    }
  });

  /**
   * Handles navigation back to the main popup
   * @function
   */
  backButton.addEventListener("click", () => {
    window.location.href = "../html/sidebar.html";
  });
}

document.addEventListener("DOMContentLoaded", initializeApiKey);
