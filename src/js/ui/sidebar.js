/**
 * @module sidebar
 * @description Core module for the Magellan extension that manages initialization, state, and coordination between modules.
 * This module handles:
 * - Extension initialization and lifecycle
 * - AI client setup and management
 * - Tab state coordination
 * - Settings and preferences management
 * - Event handling and UI coordination
 *
 * The module integrates with:
 * - ui.js for UI rendering and interaction
 * - search.js for search functionality
 * - tabState.js for state management
 * - contentScript.js for page content manipulation
 *
 * @requires chrome.storage API for settings and API key
 * @requires chrome.scripting API for content script execution
 * @requires chrome.tabs API for tab management
 * @requires OpenRouterClient class for AI functionality
 */

import {
  tabStates,
  createInitialTabState,
  setTabState,
  removeTabState,
} from "../state/tabState.js";
import { contentScript_highlightElementsById } from "../search/contentScript.js";
import { handleSearch } from "../search/search.js";
import {
  renderPopupUI,
  updateStatus,
  handleNextMatch,
  handlePrevMatch,
  handleRemoveHighlights,
} from "./ui.js";
import { initializeTheme } from "./theme.js";
import { initializeFileUpload } from "./fileUpload.js";

/** @constant {string} Storage key for the API key in Chrome's local storage */
export const API_KEY_STORAGE_KEY = "magellan_openrouter_api_key";

/** @constant {string} Storage key for the model selection */
export const MODEL_STORAGE_KEY = "magellan_model";

/** @constant {string} Storage key for the search mode setting */
export const SEARCH_MODE_STORAGE_KEY = "magellan_search_mode";

/** @constant {string} Storage key for the theme setting */
export const THEME_STORAGE_KEY = "magellan_theme";

/** @constant {string} Storage key for tracking if the user has seen the what's new screen */
export const WHATS_NEW_SEEN_KEY = "magellan_whats_new_seen";

/** @constant {string} Storage key for real-time search toggle */
export const REALTIME_TOGGLE_KEY = "magellan_realtime_toggle";

/** @constant {string} Storage key prefix for chat history persistence */
const CHAT_HISTORY_STORAGE_PREFIX = "magellan_chat_history_";

/** @constant {string} Storage key for tracking if user has completed one-time setup */
const SETUP_COMPLETE_KEY = "magellan_setup_complete";

/** @type {OpenRouterClient|null} Instance of the OpenRouter AI client */
export let ai = null;

/**
 * @typedef {Object} CitedSentence
 * @property {string} text - The text content of the cited sentence
 * @property {string} elementId - Unique identifier for the DOM element
 * @property {number} index - Index in the citations list
 */

/**
 * @typedef {Object} ChatMessage
 * @property {string} role - 'user' or 'assistant'
 * @property {string} content - The text of the message
 * @property {Array<import('./search.js').Citation>} [citations] - Citations for an assistant message
 * @property {boolean} [isExternalSource] - True if the answer is from general knowledge
 * @property {boolean} [gkPrompted] - True if the "prompt with GK" has been clicked for this message
 */

/**
 * @typedef {Object} TabState
 * @property {Array<import('./ui.js').ChatMessage>} chatHistory - Chat conversation history
 * @property {Array<import('./search.js').Citation>} citedSentences - Sentences cited from the page
 * @property {number} currentCitedSentenceIndex - Current citation being viewed
 * @property {string} status - Current status ('idle', 'searching', 'error', 'ready')
 * @property {string} [errorMessage] - Error message if status is 'error'
 * @property {string} [fullPageTextContent] - Extracted text content from the page
 * @property {Array<Object>} [pageIdentifiedElements] - Elements identified in the page
 */

/** @type {number|null} ID of the currently active tab */
export let currentActiveTabId = null;

/**
 * Initializes the AI client with the stored API key and model
 * @async
 * @function
 * @description Sets up the OpenRouter AI client using the stored API key and model.
 * Redirects to API key page if no key is found or if initialization fails.
 *
 * This function:
 * 1. Retrieves API key and model from storage
 * 2. Validates key presence
 * 3. Initializes AI client with selected model
 * 4. Handles initialization errors
 *
 * @throws {Error} If API key is missing or invalid
 *
 * @example
 * await initializeAI();
 * // AI client is ready to use
 */
async function initializeAI() {
  console.log("Initializing AI client...");

  // Clear old API key if it exists (force re-authentication with OpenRouter)
  const oldKey = "magellan_gemini_api_key";
  const oldResult = await chrome.storage.local.get([oldKey]);
  if (oldResult[oldKey]) {
    console.log("Clearing old API key...");
    await chrome.storage.local.remove([oldKey]);
  }

  const result = await chrome.storage.local.get([
    API_KEY_STORAGE_KEY,
    MODEL_STORAGE_KEY,
  ]);
  console.log("Storage result:", result);
  console.log("API key found:", !!result[API_KEY_STORAGE_KEY]);

  if (!result[API_KEY_STORAGE_KEY]) {
    console.log("No API key found, redirecting to API key page...");
    window.location.href = "../html/api-key.html";
    return;
  }

  // Check if OpenRouterClient is available
  if (typeof OpenRouterClient === "undefined") {
    console.error("OpenRouterClient class is not available");
    window.location.href = "../html/api-key.html";
    return;
  }

  try {
    // Get model from storage or use default
    let model = result[MODEL_STORAGE_KEY] || "google/gemini-2.0-flash-exp";

    // Remove :online suffix if present (we'll add it dynamically based on toggle)
    model = model.replace(/:online$/, "");

    console.log("Creating OpenRouterClient instance with model:", model);
    ai = new OpenRouterClient({
      apiKey: result[API_KEY_STORAGE_KEY],
      model: model,
    });
    console.log("AI client initialized successfully");
  } catch (error) {
    console.error("Failed to initialize AI:", error);
    window.location.href = "../html/api-key.html";
  }
}

/**
 * Gets the model to use for API calls, appending :online if real-time is enabled
 * @returns {Promise<string>} The model identifier with optional :online suffix
 */
export async function getModelForRequest() {
  const result = await chrome.storage.local.get([
    MODEL_STORAGE_KEY,
    REALTIME_TOGGLE_KEY,
  ]);
  let model = result[MODEL_STORAGE_KEY] || "google/gemini-2.0-flash-exp";

  // Remove :online suffix if present
  model = model.replace(/:online$/, "");

  // Append :online if real-time toggle is enabled
  if (result[REALTIME_TOGGLE_KEY] === true) {
    model = `${model}:online`;
  }

  return model;
}

/**
 * Initializes or refreshes the extension for the active tab
 * @async
 * @function
 * @description Manages extension state for the current tab.
 *
 * This function:
 * 1. Gets the current active tab
 * 2. Creates or retrieves tab state
 * 3. Updates UI state
 * 4. Handles tab activation errors
 *
 * Called on:
 * - Extension startup
 * - Tab activation
 * - Tab refresh
 */
async function initializeOrRefreshForActiveTab() {
  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    if (tabs.length === 0) {
      updateStatus("No active tab found.", "error");
      const searchButton = document.getElementById("searchButton");
      if (searchButton) searchButton.disabled = true;
      return;
    }
    const activeTab = tabs[0];
    currentActiveTabId = activeTab.id;

    if (!tabStates[currentActiveTabId]) {
      setTabState(currentActiveTabId, createInitialTabState());

      // Try to restore chat history from storage
      const storageKey = `${CHAT_HISTORY_STORAGE_PREFIX}${currentActiveTabId}`;
      try {
        const result = await chrome.storage.local.get([storageKey]);
        if (result[storageKey] && Array.isArray(result[storageKey])) {
          tabStates[currentActiveTabId].chatHistory = result[storageKey];
          console.log(
            `Restored ${result[storageKey].length} chat messages for tab ${currentActiveTabId}`
          );
        }
      } catch (error) {
        console.error("Error restoring chat history:", error);
      }
    }
    renderPopupUI();
  });
}

// Initialize the extension when the page loads
document.addEventListener("DOMContentLoaded", async () => {
  await initializeAI();

  // Check if user needs to complete one-time setup
  const setupResult = await chrome.storage.local.get([
    SETUP_COMPLETE_KEY,
    API_KEY_STORAGE_KEY,
    MODEL_STORAGE_KEY,
  ]);

  const setupComplete = setupResult[SETUP_COMPLETE_KEY];
  const hasApiKey = !!setupResult[API_KEY_STORAGE_KEY];
  const hasModel = !!setupResult[MODEL_STORAGE_KEY];

  // If no API key, go to API key page
  if (!hasApiKey) {
    console.log("No API key found, redirecting to API key page...");
    window.location.href = "../html/api-key.html";
    return;
  }

  // If user has API key and model but setup not marked complete, mark it complete
  // This handles existing users who already set up before this flow was added
  if (hasApiKey && hasModel && !setupComplete) {
    console.log(
      "User has API key and model but setup not marked complete, marking as complete..."
    );
    await chrome.storage.local.set({ [SETUP_COMPLETE_KEY]: true });
    setupComplete = true; // Update local variable after storage operation
  }

  // If setup not complete (no model selected), go to model selection
  if (!setupComplete && !hasModel) {
    console.log("Setup not complete, redirecting to model selection...");
    window.location.href = "../html/model-selection.html";
    return;
  }

  // Check if user should see the "What's New" screen
  // Show it if they haven't seen it, or if they haven't seen the latest version
  const WHATS_NEW_VERSION = "2.0.0";
  const WHATS_NEW_VERSION_KEY = "magellan_whats_new_version";

  const result = await chrome.storage.local.get([
    WHATS_NEW_SEEN_KEY,
    WHATS_NEW_VERSION_KEY,
  ]);

  const whatsNewSeen = result[WHATS_NEW_SEEN_KEY];
  const seenVersion = result[WHATS_NEW_VERSION_KEY];

  if (!whatsNewSeen || seenVersion !== WHATS_NEW_VERSION) {
    console.log(
      "User hasn't seen what's new screen or needs to see new version, redirecting..."
    );
    window.location.href = "../html/whats-new.html";
    return;
  }

  initializeOrRefreshForActiveTab();
  initializeTheme();
  initializeFileUpload();

  const searchButton = document.getElementById("searchButton");
  const searchQueryEl = document.getElementById("searchQuery");
  const nextMatchButton = document.getElementById("nextMatch");
  const prevMatchButton = document.getElementById("prevMatch");
  const highlightsToggle = document.getElementById("highlightsToggle");

  // Input section collapse/expand functionality
  const inputSection = document.getElementById("inputSection");
  const collapseCaret = document.getElementById("collapseCaret");
  const INPUT_SECTION_COLLAPSED_KEY = "magellan_input_section_collapsed";

  // Initialize collapse state from storage
  chrome.storage.local.get([INPUT_SECTION_COLLAPSED_KEY], (result) => {
    const isCollapsed = result[INPUT_SECTION_COLLAPSED_KEY] === true;
    if (isCollapsed && inputSection) {
      inputSection.classList.add("collapsed");
    }
  });

  // Handle collapse caret click
  if (collapseCaret && inputSection) {
    collapseCaret.addEventListener("click", () => {
      const isCollapsed = inputSection.classList.contains("collapsed");
      if (isCollapsed) {
        inputSection.classList.remove("collapsed");
        chrome.storage.local.set({ [INPUT_SECTION_COLLAPSED_KEY]: false });
      } else {
        inputSection.classList.add("collapsed");
        chrome.storage.local.set({ [INPUT_SECTION_COLLAPSED_KEY]: true });
      }
    });
  }

  // --- Settings Dropdown Elements ---
  const settingsButton = document.getElementById("settingsButton");
  const settingsDropdown = document.getElementById("settingsDropdown");
  const toggleHighlightsDropdownItem = document.getElementById(
    "toggleHighlightsDropdownItem"
  );
  const clearChatDropdownItem = document.getElementById(
    "clearChatDropdownItem"
  );
  const changeApiKeyDropdownItem = document.getElementById(
    "changeApiKeyDropdownItem"
  );

  // Initialize search mode from storage
  chrome.storage.local.get([SEARCH_MODE_STORAGE_KEY], (result) => {
    const currentMode = result[SEARCH_MODE_STORAGE_KEY] || "blended";
    chrome.storage.local.set({ [SEARCH_MODE_STORAGE_KEY]: currentMode });
    updateSearchQueryPlaceholder(currentMode);
    updateSearchModeButtonText(currentMode);
  });

  // Search Mode Button Click Functionality
  const searchModeButton = document.getElementById("searchModeButton");

  if (searchModeButton) {
    searchModeButton.addEventListener("click", (event) => {
      event.stopPropagation();

      // Get current mode and cycle to next
      chrome.storage.local.get([SEARCH_MODE_STORAGE_KEY], (result) => {
        const currentMode = result[SEARCH_MODE_STORAGE_KEY] || "blended";
        const modes = ["blended", "page", "general"];
        const currentIndex = modes.indexOf(currentMode);
        const nextIndex = (currentIndex + 1) % modes.length;
        const nextMode = modes[nextIndex];

        // Update storage and UI
        chrome.storage.local.set({ [SEARCH_MODE_STORAGE_KEY]: nextMode });
        updateSearchQueryPlaceholder(nextMode);
        updateSearchModeButtonText(nextMode);
      });
    });
  }

  /**
   * Updates the placeholder text of the search query input field
   * @function
   * @param {string} mode - The current search mode ('page', 'blended', 'general')
   * @description Updates the search input placeholder to reflect the current search mode.
   * This provides visual feedback to users about how their search will be processed.
   */
  function updateSearchQueryPlaceholder(mode) {
    const searchQueryEl = document.getElementById("searchQuery");
    if (searchQueryEl) {
      searchQueryEl.placeholder = "Ask a question...";
    }
  }

  /**
   * Updates the search mode button text, tooltip, and icon
   * @function
   * @param {string} mode - The current search mode ('page', 'blended', 'general')
   * @description Updates the search mode button text, tooltip, and icon to reflect the current mode.
   */
  function updateSearchModeButtonText(mode) {
    const searchModeButton = document.getElementById("searchModeButton");
    if (searchModeButton) {
      const modeConfig = {
        page: {
          label: "Page",
          tooltip: "Page Context",
          icon: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M14 2v6h6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M16 13H8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M16 17H8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M10 9H8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>`,
        },
        blended: {
          label: "Blended",
          tooltip: "Blended Search",
          icon: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="2"/>
            <path d="m21 21-4.35-4.35" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <circle cx="18" cy="6" r="3" stroke="currentColor" stroke-width="1.5" fill="none"/>
          </svg>`,
        },
        general: {
          label: "General",
          tooltip: "General Knowledge",
          icon: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
            <path d="M2 12h20" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" stroke="currentColor" stroke-width="2"/>
          </svg>`,
        },
      };

      const config = modeConfig[mode] || modeConfig.blended;
      const span = document.getElementById("searchModeButtonText");
      const tooltip = document.getElementById("searchModeTooltip");
      const svg = searchModeButton.querySelector("svg");

      if (span) {
        span.textContent = config.label;
      }
      if (tooltip) {
        tooltip.textContent = config.tooltip;
      }
      if (svg && config.icon) {
        svg.outerHTML = config.icon;
      }
    }
  }

  // --- Citations Collapse/Expand Elements ---
  const citationsHeader = document.getElementById("citationsHeader");
  const citationsTitle = document.getElementById("citationsTitle");
  const citationsContentWrapper = document.getElementById(
    "citationsContentWrapper"
  );

  // Initialize highlights toggle state from storage
  chrome.storage.local.get(["highlightsVisible"], (result) => {
    if (result.highlightsVisible === undefined) {
      chrome.storage.local.set({ highlightsVisible: true });
    } else {
      highlightsToggle.checked = result.highlightsVisible;
      updateHighlightsToggleText(result.highlightsVisible);
      if (!result.highlightsVisible) {
        handleRemoveHighlights();
      }
    }
  });

  if (highlightsToggle) {
    highlightsToggle.addEventListener("change", () => {
      const isVisible = highlightsToggle.checked;
      chrome.storage.local.set({ highlightsVisible: isVisible });
      updateHighlightsToggleText(isVisible);

      if (!isVisible) {
        chrome.scripting.executeScript({
          target: { tabId: currentActiveTabId },
          func: () => {
            const highlightClasses = [
              "mgl-cited-element-highlight",
              "mgl-active-element-highlight",
            ];
            highlightClasses.forEach((cls) => {
              document
                .querySelectorAll(`.${cls}`)
                .forEach((el) => el.classList.remove(cls));
            });
          },
        });
      } else if (currentActiveTabId && tabStates[currentActiveTabId]) {
        const state = tabStates[currentActiveTabId];
        if (state.citedSentences && state.citedSentences.length > 0) {
          const elementIdsToHighlight = state.citedSentences.map(
            (cs) => cs.elementId
          );
          chrome.scripting
            .insertCSS({
              target: { tabId: currentActiveTabId },
              css: `
              .mgl-cited-element-highlight { background-color: var(--highlight-bg, rgba(99, 102, 241, 0.4)) !important; color: inherit !important; border-radius: 3px; padding: 0.1em 0.2em; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
              .mgl-active-element-highlight { outline: 2px solid var(--primary, #6366f1) !important; outline-offset: 2px !important; box-shadow: 0 0 8px rgba(99, 102, 241, 0.6) !important; }
            `,
            })
            .then(() => {
              chrome.scripting.executeScript({
                target: { tabId: currentActiveTabId },
                func: contentScript_highlightElementsById,
                args: [elementIdsToHighlight],
              });
            });
        }
      }
    });
  }

  function updateHighlightsToggleText(isVisible) {
    const toggleText = document.getElementById("highlightsToggleText");
    if (toggleText) {
      toggleText.textContent = "Show Highlights";
    }
  }

  // --- Event Listeners ---
  if (searchButton) searchButton.addEventListener("click", handleSearch);
  if (searchQueryEl) {
    searchQueryEl.addEventListener("keypress", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        handleSearch();
      }
    });
  }
  if (nextMatchButton)
    nextMatchButton.addEventListener("click", handleNextMatch);
  if (prevMatchButton)
    prevMatchButton.addEventListener("click", handlePrevMatch);

  // Settings Dropdown Functionality
  if (settingsButton && settingsDropdown) {
    settingsButton.addEventListener("click", (event) => {
      event.stopPropagation();
      settingsDropdown.classList.toggle("visible");
      settingsButton.classList.toggle("active");
    });

    document.addEventListener("click", (event) => {
      if (
        settingsDropdown.classList.contains("visible") &&
        !settingsButton.contains(event.target) &&
        !settingsDropdown.contains(event.target)
      ) {
        settingsDropdown.classList.remove("visible");
        settingsButton.classList.remove("active");
      }
    });
  }

  function closeSettingsDropdown() {
    if (settingsDropdown && settingsButton) {
      settingsDropdown.classList.remove("visible");
      settingsButton.classList.remove("active");
    }
  }

  if (toggleHighlightsDropdownItem) {
    toggleHighlightsDropdownItem.addEventListener("click", (event) => {
      event.preventDefault();
      highlightsToggle.checked = !highlightsToggle.checked;
      highlightsToggle.dispatchEvent(new Event("change"));
    });
  }

  if (clearChatDropdownItem) {
    clearChatDropdownItem.addEventListener("click", async () => {
      if (currentActiveTabId && tabStates[currentActiveTabId]) {
        const state = tabStates[currentActiveTabId];
        state.chatHistory = [];
        state.citedSentences = [];
        state.currentCitedSentenceIndex = -1;
        state.errorMessage = "";
        state.status = "idle";

        // Clear persisted chat history
        const storageKey = `${CHAT_HISTORY_STORAGE_PREFIX}${currentActiveTabId}`;
        try {
          await chrome.storage.local.remove([storageKey]);
        } catch (error) {
          console.error("Error clearing chat history from storage:", error);
        }

        renderPopupUI();
        updateStatus("Chat cleared. Ask a new question.", "idle");
      }
      handleRemoveHighlights();
      closeSettingsDropdown();
    });
  }

  const whatsNewDropdownItem = document.getElementById("whatsNewDropdownItem");
  if (whatsNewDropdownItem) {
    whatsNewDropdownItem.addEventListener("click", () => {
      window.location.href = "../html/whats-new.html";
      closeSettingsDropdown();
    });
  }

  const helpDropdownItem = document.getElementById("helpDropdownItem");
  if (helpDropdownItem) {
    helpDropdownItem.addEventListener("click", () => {
      window.location.href = "../html/help.html";
      closeSettingsDropdown();
    });
  }

  if (changeApiKeyDropdownItem) {
    changeApiKeyDropdownItem.addEventListener("click", async () => {
      // Save chat history before navigating
      if (currentActiveTabId && tabStates[currentActiveTabId]) {
        const storageKey = `${CHAT_HISTORY_STORAGE_PREFIX}${currentActiveTabId}`;
        try {
          await chrome.storage.local.set({
            [storageKey]: tabStates[currentActiveTabId].chatHistory,
          });
          console.log(`Saved chat history before navigating to API key page`);
        } catch (error) {
          console.error("Error saving chat history:", error);
        }
      }
      window.location.href = "../html/api-key.html";
      closeSettingsDropdown();
    });
  }

  // Tab Switching Functionality
  const chatTab = document.getElementById("chatTab");
  const citationsTab = document.getElementById("citationsTab");
  const chatTabContent = document.getElementById("chatTabContent");
  const citationsTabContent = document.getElementById("citationsTabContent");

  function switchTab(tabName) {
    const wasChat = chatTabContent.classList.contains("active");
    const isChat = tabName === "chat";

    // Determine slide direction
    const slideDirection = isChat ? -1 : 1;

    // Update tab buttons
    if (tabName === "chat") {
      chatTab.classList.add("active");
      citationsTab.classList.remove("active");

      // Animate out citations tab
      if (citationsTabContent.classList.contains("active")) {
        citationsTabContent.classList.add("sliding-out");
        setTimeout(() => {
          citationsTabContent.classList.remove("active", "sliding-out");
          chatTabContent.classList.add("active");
        }, 50);
      } else {
        chatTabContent.classList.add("active");
        citationsTabContent.classList.remove("active");
      }
    } else if (tabName === "citations") {
      citationsTab.classList.add("active");
      chatTab.classList.remove("active");

      // Animate out chat tab
      if (chatTabContent.classList.contains("active")) {
        chatTabContent.classList.add("sliding-out");
        setTimeout(() => {
          chatTabContent.classList.remove("active", "sliding-out");
          citationsTabContent.classList.add("active");
          // Re-render UI to update citations when switching to citations tab
          renderPopupUI();
        }, 50);
      } else {
        citationsTabContent.classList.add("active");
        chatTabContent.classList.remove("active");
        // Re-render UI to update citations when switching to citations tab
        renderPopupUI();
      }
    }
  }

  if (chatTab && citationsTab) {
    chatTab.addEventListener("click", () => switchTab("chat"));
    citationsTab.addEventListener("click", () => switchTab("citations"));
  }

  // Export switchTab for use in other modules
  window.switchToCitationsTab = () => switchTab("citations");
  window.switchToChatTab = () => switchTab("chat");

  // Theme toggle elements
  const themeToggleDropdownItem = document.getElementById(
    "themeToggleDropdownItem"
  );
  const themeToggleGroup = document.getElementById("themeToggleGroup");
  const themeRadios = document.querySelectorAll('input[name="theme"]');

  // Initialize theme radio buttons from storage
  chrome.storage.local.get([THEME_STORAGE_KEY], (result) => {
    const savedTheme = result[THEME_STORAGE_KEY] || "system";
    document.querySelector(
      `input[name="theme"][value="${savedTheme}"]`
    ).checked = true;
  });

  // Theme toggle dropdown functionality
  if (themeToggleDropdownItem && themeToggleGroup) {
    themeToggleDropdownItem.addEventListener("click", (e) => {
      e.stopPropagation();
      const isVisible = themeToggleGroup.style.display !== "none";
      themeToggleGroup.style.display = isVisible ? "none" : "block";
      themeToggleDropdownItem.querySelector(".collapse-icon").style.transform =
        isVisible ? "rotate(0deg)" : "rotate(90deg)";
    });
  }

  // Theme radio button change handler
  themeRadios.forEach((radio) => {
    radio.addEventListener("change", () => {
      if (radio.checked) {
        const theme = radio.value;
        chrome.storage.local.set({ [THEME_STORAGE_KEY]: theme });
        initializeTheme(); // Use shared theme function
      }
    });
  });

  // Model selection button
  const modelSelectButton = document.getElementById("modelSelectButton");
  const modelSelectTooltip = document.getElementById("modelSelectTooltip");

  /**
   * Gets a friendly display name for a model ID
   * @param {string} modelId - The model ID
   * @returns {string} Friendly display name
   */
  function getModelDisplayName(modelId) {
    if (!modelId) return "Gemini";

    // Extract provider and model name
    const parts = modelId.split("/");
    if (parts.length < 2) return modelId;

    const provider = parts[0];
    const model = parts[1].split(":")[0]; // Remove :free suffix if present

    // Map common providers to friendly names
    const providerMap = {
      google: "Gemini",
      openai: "GPT",
      anthropic: "Claude",
      xai: "Grok",
      "meta-llama": "Llama",
      mistralai: "Mistral",
      qwen: "Qwen",
    };

    const friendlyProvider = providerMap[provider] || provider;

    // Extract version number or key identifier
    const versionMatch = model.match(/(\d+\.?\d*|flash|beta|sonnet|opus)/i);
    if (versionMatch) {
      return `${friendlyProvider} ${versionMatch[0]}`;
    }

    return friendlyProvider;
  }

  // Update model button tooltip based on selected model
  function updateModelButtonText() {
    chrome.storage.local.get([MODEL_STORAGE_KEY], (result) => {
      const savedModel =
        result[MODEL_STORAGE_KEY] || "google/gemini-2.0-flash-exp";
      // Extract a friendly name from the model ID
      const modelName = getModelDisplayName(savedModel);
      if (modelSelectTooltip) {
        modelSelectTooltip.textContent = modelName;
      }
    });
  }

  if (modelSelectButton) {
    // Initialize model button text
    updateModelButtonText();

    // Listen for model changes (when user returns from model selection page)
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === "local" && changes[MODEL_STORAGE_KEY]) {
        updateModelButtonText();
        // Reinitialize AI client with new model
        initializeAI();
      }
    });

    // Handle model selection button click
    modelSelectButton.addEventListener("click", async () => {
      // Save chat history before navigating
      if (currentActiveTabId && tabStates[currentActiveTabId]) {
        const storageKey = `${CHAT_HISTORY_STORAGE_PREFIX}${currentActiveTabId}`;
        try {
          await chrome.storage.local.set({
            [storageKey]: tabStates[currentActiveTabId].chatHistory,
          });
          console.log(
            `Saved chat history before navigating to model selection`
          );
        } catch (error) {
          console.error("Error saving chat history:", error);
        }
      }
      window.location.href = "../html/model-selection.html";
    });
  }

  // Also update model button text when page loads (in case user navigated back)
  updateModelButtonText();

  // Real-time toggle button
  const realtimeToggle = document.getElementById("realtimeToggle");
  if (realtimeToggle) {
    // Initialize toggle state from storage
    chrome.storage.local.get([REALTIME_TOGGLE_KEY], (result) => {
      const isRealtimeEnabled = result[REALTIME_TOGGLE_KEY] === true;
      if (isRealtimeEnabled) {
        realtimeToggle.classList.add("active");
      }
    });

    // Handle toggle click
    realtimeToggle.addEventListener("click", () => {
      const isCurrentlyActive = realtimeToggle.classList.contains("active");
      const newState = !isCurrentlyActive;

      realtimeToggle.classList.toggle("active", newState);
      chrome.storage.local.set({ [REALTIME_TOGGLE_KEY]: newState });
    });
  }

  // Clear highlights when extension popup closes
  async function clearAllHighlights() {
    try {
      // Get all tabs
      const tabs = await chrome.tabs.query({});
      const { contentScript_clearHighlightsAndIds } = await import(
        "../search/contentScript.js"
      );

      // Clear highlights from all tabs
      for (const tab of tabs) {
        if (
          tab.id &&
          tab.url &&
          !tab.url.startsWith("chrome://") &&
          !tab.url.startsWith("chrome-extension://")
        ) {
          try {
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: contentScript_clearHighlightsAndIds,
            });
          } catch (error) {
            // Ignore errors (tab might not be accessible or might not have highlights)
          }
        }
      }
    } catch (error) {
      console.log("Error clearing highlights:", error);
    }
  }

  // Clear highlights when popup is about to close
  window.addEventListener("beforeunload", clearAllHighlights);

  // Also clear highlights when popup visibility changes
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      clearAllHighlights();
    }
  });
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  currentActiveTabId = tabId;
  if (!tabStates[tabId]) {
    setTabState(tabId, createInitialTabState());
  }
  renderPopupUI();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  removeTabState(tabId);
  if (currentActiveTabId === tabId) {
    currentActiveTabId = null;
  }
});
