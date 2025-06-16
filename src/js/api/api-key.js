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
 * @param {string} apiKey - The API key to validate
 * @returns {Promise<boolean>} Validation result
 * @throws {Error} If validation process fails
 *
 * @example
 * const result = await validateApiKey('AI...');
 * if (result) {
 *   console.log('API key is valid');
 * } else {
 *   console.error('Invalid API key');
 * }
 */
async function validateApiKey(apiKey) {
  try {
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models?key=" + apiKey
    );
    if (!response.ok) {
      throw new Error("Invalid API key");
    }
    return true;
  } catch (error) {
    console.error("API key validation error:", error);
    return false;
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
  try {
    const { apiKey } = await chrome.storage.local.get(["apiKey"]);
    if (apiKey) {
      const input = document.getElementById("apiKeyInput");
      input.value = apiKey;
      // Validate the stored key on load
      const isValid = await validateApiKey(apiKey);
      updateApiKeyStatus(isValid);
    }
  } catch (error) {
    console.error("Error initializing API key:", error);
  }
}

function updateApiKeyStatus(isValid, message) {
  const input = document.getElementById("apiKeyInput");
  const successIcon = document.querySelector(".api-key-status-icon.success");
  const errorIcon = document.querySelector(".api-key-status-icon.error");
  const saveButton = document.getElementById("saveApiKey");

  // Remove all status classes
  input.classList.remove("success", "error");
  successIcon.classList.remove("visible");
  errorIcon.classList.remove("visible");

  if (isValid === true) {
    input.classList.add("success");
    successIcon.classList.add("visible");
    saveButton.disabled = false;
  } else if (isValid === false || message) {
    input.classList.add("error");
    errorIcon.classList.add("visible");
    saveButton.disabled = true;
  } else {
    saveButton.disabled = false;
  }
}

document.getElementById("saveApiKey").addEventListener("click", async () => {
  const apiKey = document.getElementById("apiKeyInput").value.trim();
  if (!apiKey) {
    updateApiKeyStatus(false, "Please enter an API key");
    return;
  }

  try {
    const isValid = await validateApiKey(apiKey);
    if (isValid) {
      await chrome.storage.local.set({ apiKey });
      updateApiKeyStatus(true);
      setTimeout(() => {
        window.location.href = "sidebar.html";
      }, 500);
    } else {
      updateApiKeyStatus(false, "Invalid API key");
      // Clear the stored API key if the new one is invalid
      await chrome.storage.local.remove(["apiKey"]);
    }
  } catch (error) {
    console.error("Error validating API key:", error);
    updateApiKeyStatus(false, "Error validating API key");
    // Clear the stored API key on error
    await chrome.storage.local.remove(["apiKey"]);
  }
});

document.getElementById("apiKeyInput").addEventListener("input", (e) => {
  const value = e.target.value.trim();
  if (value) {
    updateApiKeyStatus(null);
    chrome.storage.local.remove(["apiKey"]);
  } else {
    updateApiKeyStatus(false, "Please enter an API key");
  }
});

document.addEventListener("DOMContentLoaded", initializeApiKey);
