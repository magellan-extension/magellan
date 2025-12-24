/**
 * @fileoverview Model Selection Management for Magellan
 * @description Handles the model selection interface, validation, and storage.
 * This module provides functionality for selecting AI models, validating custom models,
 * and managing the model selection UI.
 *
 * @requires chrome.storage API
 * @requires OpenRouterClient class
 */

/** @constant {string} Storage key for the model selection */
const MODEL_STORAGE_KEY = "magellan_model";

/** @constant {string} Storage key for tracking if user has completed one-time setup */
const SETUP_COMPLETE_KEY = "magellan_setup_complete";

/** @constant {string} Storage key for the API key */
const API_KEY_STORAGE_KEY = "magellan_openrouter_api_key";

// Popular paid models
const POPULAR_MODELS = [
  { id: "anthropic/claude-sonnet-4.5", name: "Claude Sonnet 4.5" },
  { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash" },
  { id: "deepseek/deepseek-v3.2", name: "DeepSeek V3.2" },
  { id: "x-ai/grok-4.1-fast", name: "Grok 4.1 Fast" },
  { id: "openai/gpt-oss-120b", name: "GPT OSS 120B" },
];

// Free models (with daily rate limits)
const FREE_MODELS = [
  { id: "google/gemini-2.0-flash-exp:free", name: "Gemini 2.0 Flash" },
  { id: "xiaomi/mimo-v2-flash:free", name: "Xiaomi MiMo V2 Flash" },
  { id: "mistralai/devstral-2512:free", name: "Mistral Devstral 2 2512" },
  { id: "meta-llama/llama-3.3-70b-instruct:free", name: "Llama 3.3 70B" },
  { id: "deepseek/deepseek-r1-0528:free", name: "DeepSeek R1" },
];

let selectedModel = null;
let customModelValid = false;

/**
 * Validates a custom model ID by checking if it exists in OpenRouter
 * @param {string} modelId - The model ID to validate
 * @param {string} apiKey - The OpenRouter API key
 * @returns {Promise<boolean>} Validation result
 */
async function validateCustomModel(modelId, apiKey) {
  try {
    console.log("Validating custom model:", modelId);
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error("Failed to fetch models");
    }

    const data = await response.json();
    const models = data.data || [];
    const modelExists = models.some((model) => model.id === modelId);

    console.log("Model validation result:", modelExists);
    return modelExists;
  } catch (error) {
    console.error("Error validating model:", error);
    return false;
  }
}

/**
 * Updates the custom model input status
 * @param {boolean|null} isValid - true for valid, false for invalid, null for neutral
 */
function updateCustomModelStatus(isValid) {
  const input = document.getElementById("customModelInput");
  const successIcon = document.querySelector(
    ".custom-model-status-icon.success"
  );
  const errorIcon = document.querySelector(".custom-model-status-icon.error");
  const loadingIcon = document.querySelector(
    ".custom-model-status-icon.loading"
  );
  const validateButton = document.getElementById("validateCustomModel");

  // Hide all icons
  successIcon.classList.remove("visible");
  errorIcon.classList.remove("visible");
  loadingIcon.classList.remove("visible");

  // Remove status classes
  input.classList.remove("success", "error");

  if (isValid === true) {
    input.classList.add("success");
    successIcon.classList.add("visible");
    customModelValid = true;
    validateButton.disabled = false;
  } else if (isValid === false) {
    input.classList.add("error");
    errorIcon.classList.add("visible");
    customModelValid = false;
    validateButton.disabled = false;
  } else if (isValid === null) {
    // Loading state
    loadingIcon.classList.add("visible");
    validateButton.disabled = true;
  } else {
    validateButton.disabled = !input.value.trim();
  }
}

/**
 * Renders model cards in a grid
 * @param {Array} models - Array of model objects with id and name
 * @param {HTMLElement} container - Container element to render into
 */
function renderModelCards(models, container) {
  container.innerHTML = "";
  models.forEach((model) => {
    const card = document.createElement("div");
    card.className = "model-card";
    card.dataset.modelId = model.id;
    card.innerHTML = `
      <div class="model-card-name">${model.name}</div>
      <div class="model-card-id">${model.id}</div>
    `;
    card.addEventListener("click", () => {
      // Remove selection from all cards
      document
        .querySelectorAll(".model-card")
        .forEach((c) => c.classList.remove("selected"));
      // Select this card
      card.classList.add("selected");
      selectedModel = model.id;
      // Clear custom input
      document.getElementById("customModelInput").value = "";
      updateCustomModelStatus(undefined);
      customModelValid = false;
      const validateButton = document.getElementById("validateCustomModel");
      if (validateButton) {
        validateButton.classList.remove("success");
      }
      updateSaveButton();
    });
    container.appendChild(card);
  });
}

/**
 * Updates the save button state
 */
function updateSaveButton() {
  const saveButton = document.getElementById("saveModel");
  // Save button should only be enabled for validated custom models
  saveButton.disabled = !customModelValid;
}

/**
 * Initializes the model selection interface
 */
async function initializeModelSelection() {
  // Load saved model
  const result = await chrome.storage.local.get([MODEL_STORAGE_KEY]);
  const savedModel = result[MODEL_STORAGE_KEY];

  // Render model grids
  const popularGrid = document.getElementById("popularModelsGrid");
  const freeGrid = document.getElementById("freeModelsGrid");
  renderModelCards(POPULAR_MODELS, popularGrid);
  renderModelCards(FREE_MODELS, freeGrid);

  // Select saved model if it exists
  if (savedModel) {
    // Check if it's in popular models
    const popularModel = POPULAR_MODELS.find((m) => m.id === savedModel);
    if (popularModel) {
      const card = popularGrid.querySelector(`[data-model-id="${savedModel}"]`);
      if (card) {
        card.classList.add("selected");
        selectedModel = savedModel;
      }
    } else {
      // Check if it's in free models
      const freeModel = FREE_MODELS.find((m) => m.id === savedModel);
      if (freeModel) {
        const card = freeGrid.querySelector(`[data-model-id="${savedModel}"]`);
        if (card) {
          card.classList.add("selected");
          selectedModel = savedModel;
        }
      } else {
        // It's a custom model
        document.getElementById("customModelInput").value = savedModel;
        customModelValid = true;
        updateCustomModelStatus(true);
      }
    }
  }

  updateSaveButton();

  // Custom model input handler
  const customInput = document.getElementById("customModelInput");
  customInput.addEventListener("input", (e) => {
    const value = e.target.value.trim();
    if (value) {
      // Clear selection from cards
      document
        .querySelectorAll(".model-card")
        .forEach((c) => c.classList.remove("selected"));
      selectedModel = null;
      updateCustomModelStatus(undefined);
      customModelValid = false;
      // Remove success state from validate button
      const validateButton = document.getElementById("validateCustomModel");
      if (validateButton) {
        validateButton.classList.remove("success");
      }
    }
    updateSaveButton();
  });

  customInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && customInput.value.trim()) {
      document.getElementById("validateCustomModel").click();
    }
  });

  // Validate custom model button
  const validateButton = document.getElementById("validateCustomModel");
  validateButton.addEventListener("click", async () => {
    const modelId = customInput.value.trim();
    if (!modelId) {
      updateCustomModelStatus(false);
      return;
    }

    // Get API key
    const apiKeyResult = await chrome.storage.local.get([API_KEY_STORAGE_KEY]);
    if (!apiKeyResult[API_KEY_STORAGE_KEY]) {
      alert("Please set your OpenRouter API key first.");
      window.location.href = "../html/api-key.html";
      return;
    }

    updateCustomModelStatus(null); // Show loading
    validateButton.disabled = true;
    validateButton.classList.remove("success");

    const isValid = await validateCustomModel(
      modelId,
      apiKeyResult[API_KEY_STORAGE_KEY]
    );

    updateCustomModelStatus(isValid);
    if (isValid) {
      validateButton.classList.add("success");
    } else {
      validateButton.classList.remove("success");
    }
    updateSaveButton();
  });

  // Save button - only for custom models
  const saveButton = document.getElementById("saveModel");
  saveButton.addEventListener("click", async () => {
    // Only save if custom model is valid
    if (!customModelValid) {
      return;
    }

    const modelToSave = customInput.value.trim();
    if (!modelToSave) {
      return;
    }

    await chrome.storage.local.set({ [MODEL_STORAGE_KEY]: modelToSave });
    console.log("Custom model saved:", modelToSave);

    // Mark setup as complete (one-time setup flow)
    await chrome.storage.local.set({ [SETUP_COMPLETE_KEY]: true });
    console.log("Setup marked as complete");

    // Redirect back to sidebar
    window.location.href = "../html/sidebar.html";
  });

  // Back button
  const backButton = document.getElementById("backButton");
  backButton.addEventListener("click", async () => {
    // Save the selected model if one is selected
    if (selectedModel) {
      await chrome.storage.local.set({ [MODEL_STORAGE_KEY]: selectedModel });
      console.log("Model saved before going back:", selectedModel);
      
      // Mark setup as complete (one-time setup flow)
      await chrome.storage.local.set({ [SETUP_COMPLETE_KEY]: true });
      console.log("Setup marked as complete");
    }
    
    window.location.href = "../html/sidebar.html";
  });
}

// Initialize when DOM is ready
document.addEventListener("DOMContentLoaded", initializeModelSelection);
