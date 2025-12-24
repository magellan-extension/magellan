/**
 * @fileoverview API Key Management for Magellan
 * @description Handles the storage, validation, and management of the OpenRouter API key.
 * This module provides functionality for validating API keys, storing them securely,
 * and managing the API key UI interface.
 *
 * @requires chrome.storage API
 * @requires OpenRouterClient class
 */

/** @constant {string} Storage key for the API key in Chrome's local storage */
const API_KEY_STORAGE_KEY = "magellan_openrouter_api_key";

/** @constant {string} Storage key for tracking if the user has seen the what's new screen */
const WHATS_NEW_SEEN_KEY = "magellan_whats_new_seen";

/** @constant {string} Storage key for tracking if user has completed one-time setup */
const SETUP_COMPLETE_KEY = "magellan_setup_complete";

/**
 * Validates an OpenRouter API key
 * @param {string} apiKey - The API key to validate
 * @returns {Promise<boolean>} Validation result
 * @throws {Error} If validation process fails
 *
 * @example
 * const result = await validateApiKey('sk-or-v1-...');
 * if (result) {
 *   console.log('API key is valid');
 * } else {
 *   console.error('Invalid API key');
 * }
 */
async function validateApiKey(apiKey) {
  try {
    console.log("Starting API key validation...");
    // Validate by making a simple request to OpenRouter API
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });
    console.log("Validation response status:", response.status);
    if (!response.ok) {
      console.log("Validation failed with status:", response.status);
      throw new Error("Invalid API key");
    }
    console.log("API key validation successful");
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
    const { [API_KEY_STORAGE_KEY]: apiKey } = await chrome.storage.local.get([
      API_KEY_STORAGE_KEY,
    ]);
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
    console.log("Validating API key...");
    const isValid = await validateApiKey(apiKey);
    if (isValid) {
      console.log("API key is valid, saving to storage...");
      await chrome.storage.local.set({ [API_KEY_STORAGE_KEY]: apiKey });

      // Verify the key was saved
      const verification = await chrome.storage.local.get([
        API_KEY_STORAGE_KEY,
      ]);
      console.log(
        "Verification - saved key:",
        !!verification[API_KEY_STORAGE_KEY]
      );

      console.log("API key saved successfully, checking next step...");
      updateApiKeyStatus(true);

      // Check if this is part of the one-time setup flow
      const {
        [SETUP_COMPLETE_KEY]: setupComplete,
        [WHATS_NEW_SEEN_KEY]: whatsNewSeen,
      } = await chrome.storage.local.get([
        SETUP_COMPLETE_KEY,
        WHATS_NEW_SEEN_KEY,
      ]);

      let targetPage;
      if (!setupComplete) {
        // First time setup: go to model selection
        targetPage = "model-selection.html";
        console.log("First time setup - redirecting to model selection");
      } else if (!whatsNewSeen) {
        // User hasn't seen what's new yet
        targetPage = "whats-new.html";
        console.log("Redirecting to what's new page");
      } else {
        // Setup complete, go to sidebar
        targetPage = "sidebar.html";
        console.log("Setup complete - redirecting to sidebar");
      }

      setTimeout(() => {
        console.log(`Redirecting to ${targetPage}...`);
        try {
          // Check if we're in a popup context
          if (window.location.search.includes("popup=true") || window.opener) {
            // We're in a popup, close it and let the extension handle the side panel
            window.close();
          } else {
            // We're in a side panel or regular page, redirect normally
            window.location.href = targetPage;
          }
        } catch (error) {
          console.error("Error during redirection:", error);
          // Fallback: try to reload the page
          window.location.reload();
        }
      }, 200);
    } else {
      console.log("API key validation failed");
      updateApiKeyStatus(false, "Invalid API key");
      // Clear the stored API key if the new one is invalid
      await chrome.storage.local.remove([API_KEY_STORAGE_KEY]);
    }
  } catch (error) {
    console.error("Error validating API key:", error);
    updateApiKeyStatus(false, "Error validating API key");
    // Clear the stored API key on error
    await chrome.storage.local.remove([API_KEY_STORAGE_KEY]);
  }
});

document.getElementById("apiKeyInput").addEventListener("input", (e) => {
  const value = e.target.value.trim();
  if (value) {
    updateApiKeyStatus(null);
    chrome.storage.local.remove([API_KEY_STORAGE_KEY]);
  } else {
    updateApiKeyStatus(false, "Please enter an API key");
  }
});

// Add Enter key handler for the input field
document.getElementById("apiKeyInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    document.getElementById("saveApiKey").click();
  }
});

// Continue button handler
const continueButton = document.getElementById("continueButton");
if (continueButton) {
  continueButton.addEventListener("click", async () => {
    // Check if API key is saved
    const { [API_KEY_STORAGE_KEY]: apiKey } = await chrome.storage.local.get([
      API_KEY_STORAGE_KEY,
    ]);
    
    if (!apiKey) {
      // If no API key, focus the input
      const input = document.getElementById("apiKeyInput");
      if (input) {
        input.focus();
      }
      return;
    }

    // Check if this is part of the one-time setup flow
    const {
      [SETUP_COMPLETE_KEY]: setupComplete,
      [WHATS_NEW_SEEN_KEY]: whatsNewSeen,
    } = await chrome.storage.local.get([
      SETUP_COMPLETE_KEY,
      WHATS_NEW_SEEN_KEY,
    ]);

    let targetPage;
    if (!setupComplete) {
      // First time setup: go to model selection
      targetPage = "model-selection.html";
    } else if (!whatsNewSeen) {
      // User hasn't seen what's new yet
      targetPage = "whats-new.html";
    } else {
      // Setup complete, go to sidebar
      targetPage = "sidebar.html";
    }

    window.location.href = targetPage;
  });
}

document.addEventListener("DOMContentLoaded", initializeApiKey);
