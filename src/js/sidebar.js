/**
 * @fileoverview Sidebar UI and Interaction Logic for Magellan
 * @description Manages the main user interface and interaction logic for the Magellan extension.
 * This module handles:
 * - Chat interface and conversation history
 * - UI state management and rendering
 * - Settings and preferences
 * - Navigation between citations
 * - Integration with search functionality
 *
 * @requires chrome.storage API
 * @requires chrome.scripting API
 * @requires chrome.tabs API
 * @requires GoogleGenAI class
 */

import { parseMarkdown } from "./utils.js";
import {
  tabStates,
  createInitialTabState,
  getTabState,
  setTabState,
  removeTabState,
} from "./tabState.js";
import {
  contentScript_clearHighlightsAndIds,
  contentScript_extractAndIdRelevantElements,
  contentScript_highlightElementsById,
} from "./contentScript.js";
import { performLLMSearch } from "./search.js";

/** @constant {string} Storage key for the API key in Chrome's local storage */
export const API_KEY_STORAGE_KEY = "magellan_gemini_api_key";

/** @constant {string} Storage key for the search mode setting */
export const SEARCH_MODE_STORAGE_KEY = "magellan_search_mode";

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
 * @property {Array<ChatMessage>} chatHistory - Chat conversation history
 * @property {Array<CitedSentence>} citedSentences - Sentences cited from the page
 * @property {number} currentCitedSentenceIndex - Current citation being viewed
 * @property {string} status - Current status ('idle', 'searching', 'error')
 * @property {string} errorMessage - Error message if status is 'error'
 * @property {string} fullPageTextContent - Extracted text content from the page
 * @property {Array<Object>} pageIdentifiedElements - Elements identified in the page
 */

/** @type {number|null} ID of the currently active tab */
export let currentActiveTabId = null;

/**
 * Initializes the AI client with the stored API key
 * @async
 * @function
 * @throws {Error} If API key is missing or invalid
 *
 * @example
 * await initializeAI();
 * // AI client is ready to use
 */
async function initializeAI() {
  const result = await chrome.storage.local.get([API_KEY_STORAGE_KEY]);
  if (!result[API_KEY_STORAGE_KEY]) {
    window.location.href = "../html/api-key.html";
    return;
  }
  try {
    ai = new GoogleGenAI({ apiKey: result[API_KEY_STORAGE_KEY] });
  } catch (error) {
    console.error("Failed to initialize AI:", error);
    window.location.href = "../html/api-key.html";
  }
}

/**
 * Initializes or refreshes the extension for the active tab
 * @async
 * @function
 *
 * This function:
 * 1. Gets the current active tab
 * 2. Creates or retrieves tab state
 * 3. Extracts page content if needed
 * 4. Updates the UI
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
  initializeOrRefreshForActiveTab();

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
    if (result[SEARCH_MODE_STORAGE_KEY] === undefined) {
      chrome.storage.local.set({ [SEARCH_MODE_STORAGE_KEY]: "blended" });
      document.querySelector(
        'input[name="searchMode"][value="blended"]'
      ).checked = true;
    } else {
      document.querySelector(
        `input[name="searchMode"][value="${result[SEARCH_MODE_STORAGE_KEY]}"]`
      ).checked = true;
    }
    updateSearchQueryPlaceholder(result[SEARCH_MODE_STORAGE_KEY] || "blended");
    updateSearchModeTitle(result[SEARCH_MODE_STORAGE_KEY] || "blended");
  });

  // Add event listeners for search mode change
  document.querySelectorAll('input[name="searchMode"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      if (radio.checked) {
        chrome.storage.local.set({ [SEARCH_MODE_STORAGE_KEY]: radio.value });
        updateSearchQueryPlaceholder(radio.value);
        updateSearchModeTitle(radio.value);

        if (searchModeTitle && searchModeContent) {
          searchModeTitle.classList.add("collapsed");
          searchModeContent.classList.add("collapsed");
          chrome.storage.local.set({ searchModeCollapsed: true });
        }
      }
    });
  });

  // Search Mode Collapse/Expand Functionality
  const searchModeHeader = document.getElementById("searchModeHeader");
  const searchModeTitle = document.getElementById("searchModeTitle");
  const searchModeContent = document.getElementById("searchModeContent");

  if (searchModeHeader && searchModeTitle && searchModeContent) {
    searchModeTitle.classList.add("collapsed");
    searchModeContent.classList.add("collapsed");

    searchModeHeader.addEventListener("click", () => {
      const isCurrentlyCollapsed =
        searchModeTitle.classList.contains("collapsed");
      searchModeTitle.classList.toggle("collapsed", !isCurrentlyCollapsed);
      searchModeContent.classList.toggle("collapsed", !isCurrentlyCollapsed);
    });
  }

  /**
   * Updates the placeholder text of the search query input field
   * @function
   * @param {string} mode - The current search mode (unused in current implementation)
   */
  function updateSearchQueryPlaceholder(mode) {
    const searchQueryEl = document.getElementById("searchQuery");
    if (searchQueryEl) {
      searchQueryEl.placeholder = "Ask a question...";
    }
  }

  /**
   * Updates the search mode dropdown title to show the current mode
   * @function
   * @param {string} mode - The current search mode ('page', 'blended', or 'general')
   *
   * @example
   * updateSearchModeTitle('page'); // Shows "Search Mode: Page Context"
   * updateSearchModeTitle('blended'); // Shows "Search Mode: Blended"
   * updateSearchModeTitle('general'); // Shows "Search Mode: Gen. Knowledge"
   */
  function updateSearchModeTitle(mode) {
    const searchModeTitle = document.getElementById("searchModeTitle");
    if (searchModeTitle) {
      const modeLabels = {
        page: "Page Context",
        blended: "Blended",
        general: "Gen. Knowledge",
      };
      const label = modeLabels[mode] || "Blended";
      searchModeTitle.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        Search Mode: ${label}
        <svg class="collapse-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M9 5l7 7-7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      `;
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

/**
 * Renders the main popup UI based on current state
 * @function
 *
 * Updates all UI elements including:
 * - Chat history
 * - Citations
 * - Search status
 * - Navigation controls
 * - Settings state
 */
export function renderPopupUI() {
  const state = getTabState(currentActiveTabId);
  if (!state) return;

  renderChatLog(state.chatHistory, state.status);

  let statusMessage = "";
  let statusType = "idle";

  switch (state.status) {
    case "idle":
      statusMessage =
        state.errorMessage ||
        (state.chatHistory.length === 0
          ? "Enter a query to get started."
          : "Ready for your next question.");
      statusType = state.errorMessage ? "warning" : "idle";
      break;
    case "extracting":
      statusMessage = "Extracting page content & assigning IDs...";
      statusType = "warning";
      break;
    case "querying_llm":
      statusMessage = "Asking Magellan AI...";
      statusType = "warning";
      break;
    case "ready":
      const lastMessage = state.chatHistory[state.chatHistory.length - 1];
      if (lastMessage?.isExternalSource) {
        statusMessage = "Answered with general knowledge.";
        statusType = "success";
      } else {
        statusMessage = state.errorMessage || "Response received.";
        if (!state.errorMessage && state.citedSentences.length > 0) {
          statusMessage += ` ${state.citedSentences.length} citation(s) found.`;
        } else if (
          !state.errorMessage &&
          state.chatHistory.length > 0 &&
          lastMessage?.role === "assistant" &&
          state.citedSentences.length === 0
        ) {
          if (
            lastMessage.role === "assistant" &&
            (!lastMessage.citations || lastMessage.citations.length === 0)
          ) {
            statusMessage += " No direct citations found for this response.";
          }
        }
        statusType = state.errorMessage ? "error" : "success";
      }
      break;
    case "error":
      statusMessage = state.errorMessage || "An error occurred.";
      statusType = "error";
      break;
    default:
      statusMessage = "Unknown state.";
      statusType = "warning";
  }
  updateStatus(statusMessage, statusType);

  const isLoading =
    state.status === "extracting" || state.status === "querying_llm";
  const searchButton = document.getElementById("searchButton");
  if (searchButton) {
    searchButton.classList.toggle("loading", isLoading);
    searchButton.disabled = isLoading;
  }
  const searchQueryEl = document.getElementById("searchQuery");
  if (searchQueryEl) searchQueryEl.disabled = isLoading;

  renderCitations(
    state.citedSentences,
    state.currentCitedSentenceIndex,
    state.pageIdentifiedElements
  );

  updateNavigationButtonsInternal(
    state.citedSentences,
    state.currentCitedSentenceIndex
  );
}

/**
 * Renders the chat conversation history
 * @param {Array<ChatMessage>} chatHistory - Chat messages
 * @param {string} currentStatus - Current search status
 */
function renderChatLog(chatHistory, currentStatus) {
  const chatLogContainer = document.getElementById("chatLogContainer");
  if (!chatLogContainer) return;
  chatLogContainer.innerHTML = "";

  chatHistory.forEach((msg, index) => {
    const messageDiv = document.createElement("div");
    messageDiv.classList.add("chat-message");
    messageDiv.classList.add(
      msg.role === "user" ? "user-message" : "assistant-message"
    );

    if (msg.role === "assistant") {
      const headerDiv = document.createElement("div");
      headerDiv.style.fontSize = "0.75rem";
      headerDiv.style.marginBottom = "0.5rem";
      headerDiv.style.fontStyle = "italic";

      if (msg.isExternalSource) {
        headerDiv.style.color = "#10b981";
        headerDiv.textContent = "Answer from general knowledge";
        messageDiv.style.borderLeftColor = "#10b981";
      } else {
        headerDiv.style.color = "#6366f1";
        headerDiv.textContent = "Answer from page context";
        messageDiv.style.borderLeftColor = "#6366f1";
      }
      messageDiv.appendChild(headerDiv);
    }

    const contentDiv = document.createElement("div");
    contentDiv.style.wordBreak = "break-word";

    if (msg.role === "assistant") {
      contentDiv.innerHTML = parseMarkdown(msg.content);
    } else {
      contentDiv.style.whiteSpace = "pre-wrap";
      contentDiv.textContent = msg.content;
    }

    messageDiv.appendChild(contentDiv);

    // Add "Prompt with general knowledge" button for page-context answers
    if (
      msg.role === "assistant" &&
      !msg.isExternalSource &&
      !msg.gkPrompted &&
      chatHistory[index - 1]?.role === "user"
    ) {
      const originalQuery = chatHistory[index - 1].content;
      const generalKnowledgeContainer = document.createElement("div");
      generalKnowledgeContainer.className =
        "general-knowledge-prompt-container";

      const button = document.createElement("button");
      button.className = "general-knowledge-prompt-button";
      button.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="2" y1="12" x2="22" y2="12"></line>
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
        </svg>
        <span style="color: #10b981; font-weight: 500;">Prompt with general knowledge</span>
        <div class="spinner" style="display: none;"></div>
      `;
      button.style.cssText = `
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border: 1px solid #10b981;
        border-radius: 10px;
        background-color: rgba(16, 185, 129, 0.1);
        transition: all 0.2s ease;
        cursor: pointer;
      `;
      button.addEventListener("mouseover", () => {
        button.style.backgroundColor = "rgba(16, 185, 129, 0.2)";
      });
      button.addEventListener("mouseout", () => {
        button.style.backgroundColor = "rgba(16, 185, 129, 0.1)";
      });
      button.addEventListener("click", async (event) => {
        event.stopPropagation(); // Prevent container click events

        const state = tabStates[currentActiveTabId];
        if (!state || !ai || state.status === "querying_llm") return;

        const messageInHistory = state.chatHistory[index];
        if (messageInHistory) {
          messageInHistory.gkPrompted = true;
        }

        button.disabled = true;
        const textSpan = button.querySelector("span");
        const iconSvg = button.querySelector("svg");
        const spinnerDiv = button.querySelector(".spinner");
        if (textSpan) textSpan.style.display = "none";
        if (iconSvg) iconSvg.style.display = "none";
        if (spinnerDiv) spinnerDiv.style.display = "inline-block";

        state.status = "querying_llm";
        updateStatus("Asking Magellan AI...", "warning");
        document.getElementById("searchButton").disabled = true;

        try {
          await performLLMSearch(originalQuery, currentActiveTabId, {
            forceGeneralKnowledge: true,
          });
        } catch (error) {
          console.error("General knowledge search error:", error);
          if (tabStates[currentActiveTabId]) {
            const errorState = tabStates[currentActiveTabId];
            errorState.status = "error";
            errorState.errorMessage = "Failed to get general knowledge answer.";
            renderPopupUI();
          }
        }
      });
      generalKnowledgeContainer.appendChild(button);
      messageDiv.appendChild(generalKnowledgeContainer);
    }

    if (msg.role === "assistant" && msg.citations && msg.citations.length > 0) {
      messageDiv.classList.add("has-citations");
      messageDiv.addEventListener("click", () => {
        if (currentActiveTabId && tabStates[currentActiveTabId]) {
          const state = tabStates[currentActiveTabId];
          state.citedSentences = msg.citations;
          state.currentCitedSentenceIndex = 0;

          chrome.storage.local.get(["highlightsVisible"], async (result) => {
            const isVisible = result.highlightsVisible !== false;

            await chrome.scripting.insertCSS({
              target: { tabId: currentActiveTabId },
              css: `
                .mgl-cited-element-highlight { background-color: var(--highlight-bg, rgba(99, 102, 241, 0.4)) !important; color: inherit !important; border-radius: 3px; padding: 0.1em 0.2em; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
                .mgl-active-element-highlight { outline: 2px solid var(--primary, #6366f1) !important; outline-offset: 2px !important; box-shadow: 0 0 8px rgba(99, 102, 241, 0.6) !important; }
              `,
            });

            if (isVisible) {
              const elementIdsToHighlight = msg.citations.map(
                (cs) => cs.elementId
              );
              await chrome.scripting.executeScript({
                target: { tabId: currentActiveTabId },
                func: contentScript_highlightElementsById,
                args: [elementIdsToHighlight],
              });
              navigateToMatchOnPage(currentActiveTabId, 0, true);
            }

            renderPopupUI();
          });
        }
      });
    }

    chatLogContainer.appendChild(messageDiv);
  });

  if (currentStatus === "querying_llm") {
    const loadingDiv = document.createElement("div");
    loadingDiv.className = "chat-message assistant-message loading-dots";
    loadingDiv.innerHTML = "<span></span><span></span><span></span>";
    chatLogContainer.appendChild(loadingDiv);
  }

  chatLogContainer.scrollTop = chatLogContainer.scrollHeight;
}

/**
 * Updates the status message in the UI
 * @param {string} message - Status message to display
 * @param {string} [type='idle'] - Status type ('idle', 'searching', 'error')
 */
function updateStatus(message, type = "idle") {
  const statusEl = document.getElementById("status");
  if (statusEl) {
    statusEl.textContent = message;
    statusEl.className = `status visible ${type}`;
  }
}

/**
 * Renders the citations section with navigation controls
 * @param {Array<CitedSentence>} citedSentences - List of cited sentences
 * @param {number} currentCitedSentenceIndex - Index of current citation
 * @param {Array<Object>} pageIdentifiedElements - Elements from the page
 */
function renderCitations(
  citedSentences,
  currentCitedSentenceIndex,
  pageIdentifiedElements
) {
  const citationsContainer = document.getElementById("citationsContainer");
  if (!citationsContainer) return;
  citationsContainer.innerHTML = "";

  if (!citedSentences || citedSentences.length === 0) {
    return;
  }

  const ul = document.createElement("ul");
  ul.style.listStyleType = "none";
  ul.style.padding = "0";
  ul.style.margin = "0";

  citedSentences.forEach((citation, index) => {
    const li = document.createElement("li");
    li.className = "citation-item";
    if (index === currentCitedSentenceIndex) {
      li.classList.add("active-citation");
    }

    const indexSpan = document.createElement("span");
    indexSpan.className = "citation-index";
    indexSpan.textContent = index + 1;

    const textSpan = document.createElement("span");
    textSpan.className = "citation-text";

    const pageElement = pageIdentifiedElements.find(
      (el) => el.id === citation.elementId
    );
    const displayText = pageElement ? pageElement.text : citation.text;
    textSpan.textContent = displayText;
    textSpan.title = displayText;

    li.appendChild(indexSpan);
    li.appendChild(textSpan);
    li.dataset.citationId = citation.id;
    li.dataset.elementId = citation.elementId;
    li.dataset.citationIndex = index;

    li.addEventListener("click", () => {
      const clickedIndex = parseInt(li.dataset.citationIndex, 10);
      navigateToMatchOnPage(currentActiveTabId, clickedIndex);
    });
    ul.appendChild(li);
  });
  citationsContainer.appendChild(ul);

  const activeCitationEl = citationsContainer.querySelector(".active-citation");
  if (activeCitationEl && activeCitationEl.offsetParent) {
    requestAnimationFrame(() => {
      activeCitationEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }
}

/**
 * Updates the navigation buttons state
 * @param {Array<CitedSentence>} citedSentences - List of cited sentences
 * @param {number} [currentIndex=-1] - Current citation index
 */
function updateNavigationButtonsInternal(citedSentences, currentIndex = -1) {
  const prevButton = document.getElementById("prevMatch");
  const nextButton = document.getElementById("nextMatch");
  const citationNavButtons = document.getElementById("citationNavButtons");

  if (!prevButton || !nextButton || !citationNavButtons) return;

  const hasCitations = citedSentences && citedSentences.length > 0;

  prevButton.disabled = !hasCitations;
  nextButton.disabled = !hasCitations;
  citationNavButtons.style.display = hasCitations ? "flex" : "none";
}

/**
 * Handles the search action
 * @async
 * @function
 *
 * This function:
 * 1. Gets the search query and validates input
 * 2. Updates UI to searching state
 * 3. Extracts page content if needed
 * 4. Delegates to search.js for AI-powered search
 * 5. Updates UI with results
 *
 * @throws {Error} If search fails or AI is not initialized
 * @see search.js for search implementation details
 */
async function handleSearch() {
  if (!currentActiveTabId) return;
  if (!ai) {
    updateStatus("AI not initialized. Please configure API Key.", "error");
    return;
  }

  const tabIdForSearch = currentActiveTabId;
  const state = getTabState(tabIdForSearch);
  if (!state) {
    console.error("State not found for active tab:", tabIdForSearch);
    updateStatus("Error: Tab state not found.", "error");
    return;
  }

  const searchQueryEl = document.getElementById("searchQuery");
  const query = searchQueryEl.value.trim();

  if (!query) {
    state.errorMessage = "Please enter a search query.";
    renderPopupUI();
    setTimeout(() => {
      if (
        tabStates[tabIdForSearch] &&
        state.errorMessage === "Please enter a search query."
      ) {
        state.errorMessage = "";
        if (currentActiveTabId === tabIdForSearch) renderPopupUI();
      }
    }, 2000);
    return;
  }

  state.chatHistory.push({ role: "user", content: query });
  searchQueryEl.value = "";

  // Get current search mode
  const { [SEARCH_MODE_STORAGE_KEY]: searchMode } =
    await chrome.storage.local.get([SEARCH_MODE_STORAGE_KEY]);
  let isGeneralKnowledgeMode = searchMode === "general";

  if (isGeneralKnowledgeMode) {
    // For general knowledge mode, skip all page content checks
    state.status = "querying_llm";
    state.errorMessage = "";
    state.citedSentences = [];
    state.currentCitedSentenceIndex = -1;
    state.pageIdentifiedElements = [];
    state.fullPageTextContent = "";
    renderPopupUI();
    await performLLMSearch(query, tabIdForSearch);
    return;
  }

  state.status = "extracting";
  state.errorMessage = "";
  state.citedSentences = [];
  state.currentCitedSentenceIndex = -1;
  renderPopupUI();

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabIdForSearch },
      func: contentScript_clearHighlightsAndIds,
    });

    const injectionResults = await chrome.scripting.executeScript({
      target: { tabId: tabIdForSearch },
      func: contentScript_extractAndIdRelevantElements,
    });

    if (chrome.runtime.lastError) {
      throw new Error(
        `Extraction script error: ${chrome.runtime.lastError.message}`
      );
    }
    const extractionResult = injectionResults?.[0]?.result;
    if (
      !extractionResult ||
      !extractionResult.identifiedElements ||
      typeof extractionResult.fullTextForLLM !== "string"
    ) {
      throw new Error(
        "No text or IDs found or an error occurred during extraction."
      );
    }

    if (!tabStates[tabIdForSearch]) {
      console.log("Tab closed during text extraction for tab:", tabIdForSearch);
      return;
    }

    state.pageIdentifiedElements = extractionResult.identifiedElements;
    state.fullPageTextContent = extractionResult.fullTextForLLM;

    if (
      !state.fullPageTextContent.trim() &&
      state.pageIdentifiedElements.length === 0
    ) {
      throw new Error("Page seems to be empty or no text could be extracted.");
    }

    state.status = "querying_llm";
    if (currentActiveTabId === tabIdForSearch) renderPopupUI();

    await performLLMSearch(query, tabIdForSearch);
  } catch (error) {
    console.error("Search process error:", error);
    if (tabStates[tabIdForSearch]) {
      // If in blended mode and extraction failed, fall back to general knowledge
      if (searchMode === "blended") {
        state.pageIdentifiedElements = [];
        state.fullPageTextContent = "";
        state.status = "querying_llm";
        if (currentActiveTabId === tabIdForSearch) renderPopupUI();
        await performLLMSearch(query, tabIdForSearch, {
          forceGeneralKnowledge: true,
        });
        return;
      }

      state.status = "error";
      state.errorMessage =
        error.message || "An unexpected error occurred during search.";
      state.chatHistory.push({
        role: "assistant",
        content: `Error: ${state.errorMessage}`,
      });
      if (currentActiveTabId === tabIdForSearch) renderPopupUI();
    }
  }
}

/**
 * Removes all highlights from the current page
 * @async
 * @function
 */
async function handleRemoveHighlights() {
  if (!currentActiveTabId) return;
  const state = tabStates[currentActiveTabId];

  chrome.scripting
    .executeScript({
      target: { tabId: currentActiveTabId },
      func: contentScript_clearHighlightsAndIds,
    })
    .then(() => {
      if (state) {
        updateStatus("Highlights cleared from page.", "success");
        setTimeout(() => {
          const currentStatusEl = document.getElementById("status");
          if (
            currentStatusEl &&
            currentStatusEl.textContent === "Highlights cleared from page."
          ) {
            if (state) {
              updateStatus(
                state.errorMessage ||
                  (state.status === "ready" ? "Response received." : "Idle."),
                state.status === "error"
                  ? "error"
                  : state.status === "ready"
                  ? "success"
                  : "idle"
              );
            } else {
              updateStatus("Ready.", "idle");
            }
          }
        }, 2000);
      }
    })
    .catch((err) => {
      console.error("Error clearing highlights and citations:", err);
      if (state) {
        state.errorMessage =
          "Could not clear highlights/citations. " + err.message;
        renderPopupUI();
      } else {
        updateStatus(
          "Could not clear highlights/citations. " + err.message,
          "error"
        );
      }
    });
}

/**
 * Navigates to the next citation match
 * @function
 */
function handleNextMatch() {
  if (!currentActiveTabId || !tabStates[currentActiveTabId]) return;
  const state = tabStates[currentActiveTabId];
  if (!state.citedSentences || state.citedSentences.length === 0) return;
  const newIndex =
    (state.currentCitedSentenceIndex + 1) % state.citedSentences.length;
  if (newIndex !== state.currentCitedSentenceIndex) {
    navigateToMatchOnPage(currentActiveTabId, newIndex);
  }
}

/**
 * Navigates to the previous citation match
 * @function
 */
function handlePrevMatch() {
  if (!currentActiveTabId || !tabStates[currentActiveTabId]) return;
  const state = tabStates[currentActiveTabId];
  if (!state.citedSentences || state.citedSentences.length === 0) return;
  const newIndex =
    (state.currentCitedSentenceIndex - 1 + state.citedSentences.length) %
    state.citedSentences.length;
  if (newIndex !== state.currentCitedSentenceIndex) {
    navigateToMatchOnPage(currentActiveTabId, newIndex);
  }
}

/**
 * Navigates to a citation match on the page
 * @async
 * @param {number} forTabId - ID of the tab to navigate in
 * @param {number} newIndexInPopupList - Index of the citation to navigate to
 * @param {boolean} [isInitialScroll=false] - Whether this is the initial scroll
 */
export async function navigateToMatchOnPage(
  forTabId,
  newIndexInPopupList,
  isInitialScroll = false
) {
  const state = getTabState(forTabId);
  if (
    !state ||
    !state.citedSentences ||
    state.citedSentences.length === 0 ||
    newIndexInPopupList < 0 ||
    newIndexInPopupList >= state.citedSentences.length
  ) {
    console.warn(
      "Navigation cancelled: Invalid state or index for cited sentences."
    );
    return;
  }

  const targetCitation = state.citedSentences[newIndexInPopupList];
  if (!targetCitation || !targetCitation.elementId) {
    console.warn(
      "Navigation cancelled: Target citation or elementId is missing."
    );
    return;
  }

  state.currentCitedSentenceIndex = newIndexInPopupList;

  if (forTabId === currentActiveTabId) {
    renderPopupUI();
  }

  const targetElementPageId = targetCitation.elementId;

  chrome.scripting
    .executeScript({
      target: { tabId: forTabId },
      func: (pageTargetElementId, pageIsInitialScroll) => {
        const activeClass = "mgl-active-element-highlight";
        const highlightClass = "mgl-cited-element-highlight";

        document
          .querySelectorAll(`.${activeClass}`)
          .forEach((activeEl) => activeEl.classList.remove(activeClass));
        const targetElement = document.querySelector(
          `[data-magellan-id="${pageTargetElementId}"]`
        );

        if (!targetElement) {
          console.warn(
            `Navigation: Element with Magellan ID "${pageTargetElementId}" not found on page.`
          );
          return {
            success: false,
            reason: `Element ID ${pageTargetElementId} not found`,
          };
        }
        if (!targetElement.classList.contains(highlightClass)) {
          targetElement.classList.add(highlightClass);
        }
        targetElement.classList.add(activeClass);
        targetElement.scrollIntoView({ behavior: "smooth", block: "center" });
        return { success: true, scrolledToId: pageTargetElementId };
      },
      args: [targetElementPageId, isInitialScroll],
    })
    .then((results) => {
      if (chrome.runtime.lastError) {
        console.warn(
          "Failed to navigate/scroll on page (runtime error):",
          chrome.runtime.lastError.message
        );
      } else if (
        results &&
        results[0] &&
        results[0].result &&
        !results[0].result.success
      ) {
        console.warn(
          "Failed to navigate/scroll on page (script reported failure):",
          results[0].result.reason
        );
      }
    })
    .catch((err) => console.error("Error executing navigation script:", err));
}
