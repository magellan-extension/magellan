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
 * @requires GoogleGenAI class for AI functionality
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
export const API_KEY_STORAGE_KEY = "magellan_gemini_api_key";

/** @constant {string} Storage key for the search mode setting */
export const SEARCH_MODE_STORAGE_KEY = "magellan_search_mode";

/** @constant {string} Storage key for the theme setting */
export const THEME_STORAGE_KEY = "magellan_theme";

/** @constant {string} Storage key for tracking if the user has seen the what's new screen */
export const WHATS_NEW_SEEN_KEY = "magellan_whats_new_seen";

/** @type {GoogleGenAI|null} Instance of the Google AI client */
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
 * Initializes the AI client with the stored API key
 * @async
 * @function
 * @description Sets up the Google AI client using the stored API key.
 * Redirects to API key page if no key is found or if initialization fails.
 *
 * This function:
 * 1. Retrieves API key from storage
 * 2. Validates key presence
 * 3. Initializes AI client
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
  const result = await chrome.storage.local.get([API_KEY_STORAGE_KEY]);
  console.log("Storage result:", result);
  console.log("API key found:", !!result[API_KEY_STORAGE_KEY]);

  if (!result[API_KEY_STORAGE_KEY]) {
    console.log("No API key found, redirecting to API key page...");
    window.location.href = "../html/api-key.html";
    return;
  }

  // Check if GoogleGenAI is available
  if (typeof GoogleGenAI === "undefined") {
    console.error("GoogleGenAI class is not available");
    window.location.href = "../html/api-key.html";
    return;
  }

  try {
    console.log("Creating GoogleGenAI instance...");
    ai = new GoogleGenAI({ apiKey: result[API_KEY_STORAGE_KEY] });
    console.log("AI client initialized successfully");
  } catch (error) {
    console.error("Failed to initialize AI:", error);
    window.location.href = "../html/api-key.html";
  }
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
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
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
    }
    renderPopupUI();
  });
}

// Initialize the extension when the page loads
document.addEventListener("DOMContentLoaded", async () => {
  await initializeAI();

  // Check if user should see the "What's New" screen
  const { [WHATS_NEW_SEEN_KEY]: whatsNewSeen } = await chrome.storage.local.get(
    [WHATS_NEW_SEEN_KEY]
  );
  if (!whatsNewSeen) {
    console.log("User hasn't seen what's new screen, redirecting...");
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
   * Updates the search mode button text and tooltip
   * @function
   * @param {string} mode - The current search mode ('page', 'blended', 'general')
   * @description Updates the search mode button text and tooltip to reflect the current mode.
   */
  function updateSearchModeButtonText(mode) {
    const searchModeButton = document.getElementById("searchModeButton");
    if (searchModeButton) {
      const modeConfig = {
        page: {
          label: "Page Context",
          tooltip:
            "Page Context Only - Search only within the current page content or uploaded document",
        },
        blended: {
          label: "Blended",
          tooltip:
            "Blended Search - Search page/document first, then use general knowledge if needed",
        },
        general: {
          label: "Gen. Knowledge",
          tooltip:
            "General Knowledge Only - Use only general knowledge, ignore page content",
        },
      };

      const config = modeConfig[mode] || modeConfig.blended;
      const span = searchModeButton.querySelector("span");
      if (span) {
        span.textContent = config.label;
      }
      searchModeButton.title = config.tooltip;
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
    clearChatDropdownItem.addEventListener("click", () => {
      if (currentActiveTabId && tabStates[currentActiveTabId]) {
        const state = tabStates[currentActiveTabId];
        state.chatHistory = [];
        state.citedSentences = [];
        state.currentCitedSentenceIndex = -1;
        state.errorMessage = "";
        state.status = "idle";
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

  if (changeApiKeyDropdownItem) {
    changeApiKeyDropdownItem.addEventListener("click", () => {
      window.location.href = "../html/api-key.html";
      closeSettingsDropdown();
    });
  }

  // Citations Collapse/Expand Functionality
  if (citationsHeader && citationsTitle && citationsContentWrapper) {
    chrome.storage.local.get(["citationsCollapsed"], (result) => {
      const citationsAreCollapsed = result.citationsCollapsed === true;
      if (citationsAreCollapsed) {
        citationsTitle.classList.add("collapsed");
        citationsContentWrapper.classList.add("collapsed");
      } else {
        citationsTitle.classList.remove("collapsed");
        citationsContentWrapper.classList.remove("collapsed");
      }
    });

    citationsHeader.addEventListener("click", () => {
      const isCurrentlyCollapsed =
        citationsTitle.classList.contains("collapsed");
      citationsTitle.classList.toggle("collapsed", !isCurrentlyCollapsed);
      citationsContentWrapper.classList.toggle(
        "collapsed",
        !isCurrentlyCollapsed
      );
      chrome.storage.local.set({ citationsCollapsed: !isCurrentlyCollapsed });
    });
  }

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
