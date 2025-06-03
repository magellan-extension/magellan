/**
 * @fileoverview Sidebar UI and Interaction Logic for Magellan
 * @description Manages the main user interface, chat interactions, and page content processing.
 * This module handles:
 * - Chat interface and conversation history
 * - Page content extraction and processing
 * - Citation management and navigation
 * - UI state and rendering
 * - Settings and preferences
 *
 * @requires chrome.storage API
 * @requires chrome.scripting API
 * @requires chrome.tabs API
 * @requires GoogleGenAI class
 */

/** @constant {string} Storage key for the API key in Chrome's local storage */
const API_KEY_STORAGE_KEY = "magellan_gemini_api_key";

/** @type {GoogleGenAI|null} Instance of the Google AI client */
let ai = null;

/**
 * @typedef {Object} CitedSentence
 * @property {string} text - The text content of the cited sentence
 * @property {string} elementId - Unique identifier for the DOM element
 * @property {number} index - Index in the citations list
 */

/**
 * @typedef {Object} TabState
 * @property {Array<{role: string, content: string}>} chatHistory - Chat conversation history
 * @property {Array<CitedSentence>} citedSentences - Sentences cited from the page
 * @property {number} currentCitedSentenceIndex - Current citation being viewed
 * @property {string} status - Current status ('idle', 'searching', 'error')
 * @property {string} errorMessage - Error message if status is 'error'
 * @property {string} fullPageTextContent - Extracted text content from the page
 * @property {Array<Object>} pageIdentifiedElements - Elements identified in the page
 */

/** @type {Object.<number, TabState>} State management for each tab */
const tabStates = {};

/** @type {number|null} ID of the currently active tab */
let currentActiveTabId = null;

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
 * Creates initial state for a new tab
 * @returns {TabState} Initial tab state
 */
function createInitialTabState() {
  return {
    chatHistory: [],
    citedSentences: [],
    currentCitedSentenceIndex: -1,
    status: "idle",
    errorMessage: "",
    fullPageTextContent: "",
    pageIdentifiedElements: [],
  };
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
      tabStates[currentActiveTabId] = createInitialTabState();
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
  const numCitationsInput = document.getElementById("numCitations");
  const numCitationsValueEl = document.getElementById("numCitationsValue");
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
      toggleText.textContent = isVisible
        ? "Hide Highlights"
        : "Show Highlights";
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
  if (numCitationsInput) {
    numCitationsInput.addEventListener("input", (e) => {
      if (numCitationsValueEl) numCitationsValueEl.textContent = e.target.value;
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

chrome.tabs.onActivated.addListener((activeInfo) => {
  currentActiveTabId = activeInfo.tabId;
  if (!tabStates[currentActiveTabId]) {
    tabStates[currentActiveTabId] = createInitialTabState();
  }
  renderPopupUI();
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  if (tabStates[tabId]) {
    delete tabStates[tabId];
    console.log(`Cleared state for closed tab ${tabId}`);
  }
  if (currentActiveTabId === tabId) {
    currentActiveTabId = null;
    initializeOrRefreshForActiveTab();
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
function renderPopupUI() {
  if (!currentActiveTabId || !tabStates[currentActiveTabId]) {
    updateStatus("Initializing or no active tab...", "warning");
    const searchButton = document.getElementById("searchButton");
    if (searchButton) searchButton.disabled = true;
    const chatLogContainer = document.getElementById("chatLogContainer");
    if (chatLogContainer) chatLogContainer.innerHTML = "";
    const citationsContainer = document.getElementById("citationsContainer");
    if (citationsContainer) citationsContainer.innerHTML = "";
    updateNavigationButtonsInternal([], -1);
    return;
  }

  const state = tabStates[currentActiveTabId];
  const searchButton = document.getElementById("searchButton");
  const searchQueryEl = document.getElementById("searchQuery");
  const numCitationsInput = document.getElementById("numCitations");
  const numCitationsValueEl = document.getElementById("numCitationsValue");

  renderChatLog(state.chatHistory, state.status);

  if (searchQueryEl) {
    searchQueryEl.placeholder =
      state.chatHistory.length === 0
        ? "Ask about this page..."
        : "Ask a follow-up...";
  }

  if (numCitationsValueEl && numCitationsInput) {
    numCitationsValueEl.textContent = numCitationsInput.value;
  }

  let statusMessage = "";
  let statusType = "idle";

  switch (state.status) {
    case "idle":
      statusMessage =
        state.errorMessage ||
        (state.chatHistory.length === 0
          ? "Enter a query to search the page."
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
      statusMessage = state.errorMessage || "Response received.";
      if (!state.errorMessage && state.citedSentences.length > 0) {
        statusMessage += ` ${state.citedSentences.length} citation(s) found.`;
      } else if (
        !state.errorMessage &&
        state.chatHistory.length > 0 &&
        state.chatHistory[state.chatHistory.length - 1].role === "assistant" &&
        state.citedSentences.length === 0
      ) {
        const lastMessage = state.chatHistory[state.chatHistory.length - 1];
        if (
          lastMessage.role === "assistant" &&
          (!lastMessage.citations || lastMessage.citations.length === 0)
        ) {
          statusMessage += " No direct citations found for this response.";
        }
      }
      statusType = state.errorMessage ? "error" : "success";
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
  if (searchButton) {
    searchButton.classList.toggle("loading", isLoading);
    searchButton.disabled = isLoading;
  }
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
 * @param {Array<{role: string, content: string}>} chatHistory - Chat messages
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
    messageDiv.textContent = msg.content;

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

  prevButton.disabled = !hasCitations || currentIndex <= 0;
  nextButton.disabled =
    !hasCitations || currentIndex >= citedSentences.length - 1;

  citationNavButtons.style.display = hasCitations ? "flex" : "none";
}

/**
 * Handles the search action
 * @async
 * @function
 *
 * This function:
 * 1. Gets the search query and number of citations
 * 2. Updates UI to searching state
 * 3. Extracts page content if needed
 * 4. Performs the search using the AI model
 * 5. Updates UI with results
 *
 * @throws {Error} If search fails or AI is not initialized
 */
async function handleSearch() {
  if (!currentActiveTabId) return;
  if (!ai) {
    updateStatus("AI not initialized. Please configure API Key.", "error");
    return;
  }

  const tabIdForSearch = currentActiveTabId;
  const state = tabStates[tabIdForSearch];
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
  const newIndex = Math.min(
    state.currentCitedSentenceIndex + 1,
    state.citedSentences.length - 1
  );
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
  const newIndex = Math.max(state.currentCitedSentenceIndex - 1, 0);
  if (newIndex !== state.currentCitedSentenceIndex) {
    navigateToMatchOnPage(currentActiveTabId, newIndex);
  }
}

/**
 * Performs the AI-powered search on page content
 * @async
 * @param {string} query - User's search query
 * @param {number} forTabId - ID of the tab to search in
 * @returns {Promise<{citedSentences: Array<CitedSentence>, errorMessage: string}>} Search results
 *
 * @throws {Error} If search fails or AI is not initialized
 */
async function performLLMSearch(query, forTabId) {
  const state = tabStates[forTabId];
  if (
    !state ||
    (!state.pageIdentifiedElements.length && !state.fullPageTextContent)
  ) {
    if (state) {
      state.status = "error";
      state.errorMessage = "Page content not available for LLM search.";
      state.chatHistory.push({
        role: "assistant",
        content: `Error: ${state.errorMessage}`,
      });
    }
    if (currentActiveTabId === forTabId) renderPopupUI();
    return;
  }

  const numCitationsInput = document.getElementById("numCitations");
  const numCitations = numCitationsInput
    ? parseInt(numCitationsInput.value, 10) || 3
    : 3;
  const effectiveNumCitations =
    state.pageIdentifiedElements.length > 0
      ? Math.min(numCitations, state.pageIdentifiedElements.length, 7)
      : 0;

  const prompt = `
You are an AI assistant helping a user understand the content of a webpage.
The user has asked the following question: "${query}"

Here is the relevant text content extracted from the page. Each piece of text is preceded by its unique element ID in square brackets (e.g., [mgl-node-0]).
The goal is to identify the most specific, relevant sections.
--- START OF PAGE CONTENT ---
${state.fullPageTextContent}
--- END OF PAGE CONTENT ---

Please perform the following tasks:
1.  Provide a concise answer to the user's question based *only* on the provided page content.
    If the answer cannot be found in the content, explicitly state that.
2.  Identify up to ${effectiveNumCitations} element IDs from the "PAGE CONTENT" above whose text directly supports your answer or is most relevant to the user's query.
    *   **Prioritize the SMALLEST, most specific HTML elements** that contain the relevant information. For example, if a specific sentence is in a <p> tag inside a <div>, prefer the ID of the <p> tag if its text is listed.
    *   **Avoid selecting IDs of very large elements** (e.g., main content containers, sidebars, or elements whose text seems to span a huge portion of the page content provided) unless absolutely necessary because no smaller element contains the specific information.
    *   List *only the element IDs* (the string inside the brackets, e.g., mgl-node-0), one ID per line.
    *   Do not include the sentence text in this citation list.
    If no relevant elements can be found, or if you stated the answer cannot be found, leave the citations section empty or write "NONE".

Format your response as follows:
LLM_ANSWER_START
[Your answer to the query based on the page content]
LLM_ANSWER_END
LLM_CITATIONS_START
[element_id_1_from_page_content]
[element_id_2_from_page_content]
...
LLM_CITATIONS_END
`;

  try {
    const llmResult = await ai.generateContent(prompt);
    const llmRawResponse = llmResult.text;

    if (!tabStates[forTabId]) {
      console.log("Tab closed during LLM search for tab:", forTabId);
      return;
    }

    const answerMatch = llmRawResponse.match(
      /LLM_ANSWER_START\s*([\s\S]*?)\s*LLM_ANSWER_END/
    );
    const citationsMatch = llmRawResponse.match(
      /LLM_CITATIONS_START\s*([\s\S]*?)\s*LLM_CITATIONS_END/
    );

    const assistantResponseText = answerMatch
      ? answerMatch[1].trim()
      : "LLM did not provide an answer in the expected format.";
    const rawCitationIds = citationsMatch ? citationsMatch[1].trim() : "";
    const parsedElementIds = rawCitationIds
      .split("\n")
      .map((s) => s.trim().replace(/^\[|\]$/g, ""))
      .filter(
        (s) =>
          s.length > 0 &&
          s.toUpperCase() !== "NONE" &&
          s.startsWith("mgl-node-")
      );

    const currentCitationsForThisResponse = [];
    if (
      parsedElementIds.length > 0 &&
      state.pageIdentifiedElements.length > 0
    ) {
      parsedElementIds.forEach((elementId, index) => {
        const identifiedElement = state.pageIdentifiedElements.find(
          (el) => el.id === elementId
        );
        if (identifiedElement) {
          currentCitationsForThisResponse.push({
            text: identifiedElement.text,
            elementId: elementId,
            id: `citation-${forTabId}-${Date.now()}-${index}`,
            originalIndexInLlmResponse: index,
          });
        } else {
          console.warn(
            `LLM cited element ID "${elementId}" which was not found in pageIdentifiedElements.`
          );
        }
      });
    }

    state.citedSentences = currentCitationsForThisResponse;
    state.currentCitedSentenceIndex = state.citedSentences.length > 0 ? 0 : -1;
    state.chatHistory.push({
      role: "assistant",
      content: assistantResponseText,
      citations: state.citedSentences,
    });

    if (state.citedSentences.length > 0) {
      const elementIdsToHighlight = state.citedSentences.map(
        (cs) => cs.elementId
      );
      await chrome.scripting.insertCSS({
        target: { tabId: forTabId },
        css: `
          .mgl-cited-element-highlight { background-color: var(--highlight-bg, rgba(99, 102, 241, 0.4)) !important; color: inherit !important; border-radius: 3px; padding: 0.1em 0.2em; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
          .mgl-active-element-highlight { outline: 2px solid var(--primary, #6366f1) !important; outline-offset: 2px !important; box-shadow: 0 0 8px rgba(99, 102, 241, 0.6) !important; }
        `,
      });

      const { highlightsVisible } = await chrome.storage.local.get([
        "highlightsVisible",
      ]);
      if (highlightsVisible) {
        const highlightResults = await chrome.scripting.executeScript({
          target: { tabId: forTabId },
          func: contentScript_highlightElementsById,
          args: [elementIdsToHighlight],
        });

        if (chrome.runtime.lastError || !highlightResults?.[0]?.result) {
          console.error(
            "Highlighting script error or no result:",
            chrome.runtime.lastError,
            highlightResults
          );
          if (!state.errorMessage)
            state.errorMessage = "Error applying highlights on page.";
        } else {
          const resultSummary = highlightResults[0].result;
          console.log(
            `Highlighting summary: ${resultSummary.highlightCount} elements highlighted.`
          );
          if (
            resultSummary.highlightCount < state.citedSentences.length &&
            !state.errorMessage
          ) {
            state.errorMessage = `Successfully highlighted ${resultSummary.highlightCount} of ${state.citedSentences.length} cited elements.`;
          }
          if (
            state.citedSentences.length > 0 &&
            resultSummary.highlightCount > 0
          ) {
            navigateToMatchOnPage(forTabId, 0, true);
          } else if (
            resultSummary.highlightCount === 0 &&
            state.citedSentences.length > 0 &&
            !state.errorMessage
          ) {
            state.errorMessage =
              "Cited elements were found, but could not be highlighted on the page.";
          }
        }
      }
    }

    state.status = "ready";
    if (currentActiveTabId === forTabId) {
      renderPopupUI();
    }
  } catch (error) {
    console.error("LLM Search Error:", error);
    if (tabStates[forTabId]) {
      state.status = "error";
      state.errorMessage = `LLM request error: ${
        error.message || error.toString()
      }`;
      state.chatHistory.push({
        role: "assistant",
        content: `Error: ${state.errorMessage}`,
      });
      if (currentActiveTabId === forTabId) renderPopupUI();
    }
  }
}

/**
 * Navigates to a citation match on the page
 * @async
 * @param {number} forTabId - ID of the tab to navigate in
 * @param {number} newIndexInPopupList - Index of the citation to navigate to
 * @param {boolean} [isInitialScroll=false] - Whether this is the initial scroll
 */
async function navigateToMatchOnPage(
  forTabId,
  newIndexInPopupList,
  isInitialScroll = false
) {
  const state = tabStates[forTabId];
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

// --- CONTENT SCRIPT FUNCTIONS ---
function contentScript_extractAndIdRelevantElements() {
  const selectors =
    "p, h1, h2, h3, h4, h5, h6, li, span, blockquote, td, th, pre," +
    "div:not(:has(p, h1, h2, h3, h4, h5, h6, li, article, section, main, aside, nav, header, footer, form)), " +
    "article, section, main";
  const nodes = Array.from(document.body.querySelectorAll(selectors));
  const identifiedElements = [];
  const MIN_TEXT_LENGTH = 15;
  const MAX_TEXT_LENGTH_PER_NODE = 2500;
  let idCounter = 0;
  function isVisible(elem) {
    if (!(elem instanceof Element)) return false;
    const style = getComputedStyle(elem);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.opacity === "0" ||
      elem.getAttribute("aria-hidden") === "true"
    )
      return false;
    if (
      elem.offsetWidth === 0 &&
      elem.offsetHeight === 0 &&
      !elem.matches("meta, link, script, style, title, noscript")
    )
      return false;
    if (
      style.position === "absolute" &&
      (style.left === "-9999px" || style.top === "-9999px")
    )
      return false;
    let current = elem;
    while (current && current !== document.body) {
      const tagName = current.tagName.toUpperCase();
      if (
        [
          "SCRIPT",
          "STYLE",
          "NOSCRIPT",
          "TEXTAREA",
          "IFRAME",
          "CANVAS",
          "SVG",
        ].includes(tagName)
      )
        return false;
      if (
        current === elem &&
        [
          "NAV",
          "ASIDE",
          "FOOTER",
          "HEADER",
          "FORM",
          "BUTTON",
          "A",
          "INPUT",
          "SELECT",
        ].includes(tagName)
      ) {
        let hasDirectOrSelectableChildText = false;
        for (const child of elem.childNodes) {
          if (
            child.nodeType === Node.TEXT_NODE &&
            child.textContent.trim().length > 5
          ) {
            hasDirectOrSelectableChildText = true;
            break;
          }
          if (
            child.nodeType === Node.ELEMENT_NODE &&
            child.matches(selectors) &&
            isVisible(child)
          ) {
            hasDirectOrSelectableChildText = true;
            break;
          }
        }
        if (!hasDirectOrSelectableChildText) return false;
      }
      current = current.parentElement;
    }
    return true;
  }
  const uniqueTextsSet = new Set();
  for (const node of nodes) {
    if (!isVisible(node)) continue;
    let parentWithId = node.parentElement;
    let alreadyProcessedByParent = false;
    while (parentWithId && parentWithId !== document.body) {
      if (parentWithId.dataset.magellanId) {
        alreadyProcessedByParent = true;
        break;
      }
      parentWithId = parentWithId.parentElement;
    }
    if (alreadyProcessedByParent) continue;
    let textToUse = "";
    let directText = "";
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        directText += child.textContent;
      } else if (
        child.nodeType === Node.ELEMENT_NODE &&
        !child.matches(selectors) &&
        isVisible(child)
      ) {
        directText += child.textContent;
      }
    }
    directText = directText.replace(/\s+/g, " ").trim();
    if (
      directText.length >= MIN_TEXT_LENGTH &&
      directText.length <= MAX_TEXT_LENGTH_PER_NODE
    ) {
      textToUse = directText;
    } else if (
      directText.length === 0 ||
      directText.length > MAX_TEXT_LENGTH_PER_NODE
    ) {
      const hasSelectorChildren = Array.from(
        node.querySelectorAll(selectors)
      ).some((child) => child !== node && node.contains(child));
      if (!hasSelectorChildren) {
        const fullInnerText = node.innerText
          ? node.innerText.replace(/\s+/g, " ").trim()
          : "";
        if (
          fullInnerText.length >= MIN_TEXT_LENGTH &&
          fullInnerText.length <= MAX_TEXT_LENGTH_PER_NODE
        ) {
          textToUse = fullInnerText;
        }
      }
    }
    if (
      textToUse &&
      textToUse.split(" ").length > 2 &&
      !uniqueTextsSet.has(textToUse)
    ) {
      const rect = node.getBoundingClientRect();
      const viewportArea = window.innerWidth * window.innerHeight;
      const elementArea = rect.width * rect.height;
      if (
        !["ARTICLE", "MAIN"].includes(node.tagName.toUpperCase()) &&
        elementArea > viewportArea * 0.7 &&
        rect.width > window.innerWidth * 0.9
      ) {
        continue;
      }
      const elementId = `mgl-node-${idCounter++}`;
      node.dataset.magellanId = elementId;
      identifiedElements.push({ id: elementId, text: textToUse });
      uniqueTextsSet.add(textToUse);
    }
  }
  const fullTextForLLM = identifiedElements
    .map((el) => `[${el.id}] ${el.text}`)
    .join("\n\n");
  return { identifiedElements, fullTextForLLM };
}

function contentScript_clearHighlightsAndIds() {
  const highlightClasses = [
    "mgl-cited-element-highlight",
    "mgl-active-element-highlight",
  ];
  highlightClasses.forEach((cls) => {
    document
      .querySelectorAll(`.${cls}`)
      .forEach((el) => el.classList.remove(cls));
  });
  const idElements = document.querySelectorAll("[data-magellan-id]");
  idElements.forEach((el) => {
    el.removeAttribute("data-magellan-id");
  });
  return {
    clearedIds: idElements.length,
    clearedHighlights: highlightClasses.length,
  };
}

function contentScript_highlightElementsById(elementIdsToHighlight) {
  const highlightClass = "mgl-cited-element-highlight";
  const activeClass = "mgl-active-element-highlight";
  let highlightCount = 0;
  document
    .querySelectorAll(`.${highlightClass}`)
    .forEach((el) => el.classList.remove(highlightClass));
  document
    .querySelectorAll(`.${activeClass}`)
    .forEach((el) => el.classList.remove(activeClass));
  elementIdsToHighlight.forEach((id) => {
    const element = document.querySelector(`[data-magellan-id="${id}"]`);
    if (element) {
      element.classList.add(highlightClass);
      highlightCount++;
    } else {
      console.warn(`Highlighting: Element with Magellan ID "${id}" not found.`);
    }
  });
  return { highlightCount };
}
