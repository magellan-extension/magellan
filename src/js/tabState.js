/**
 * @fileoverview Tab state management for the Magellan extension
 */

/**
 * @typedef {Object} TabState
 * @property {Array<Object>} chatHistory - Array of chat messages
 * @property {Array<Object>} citedSentences - Array of cited sentences
 * @property {number} currentCitedSentenceIndex - Index of the current cited sentence
 * @property {string} status - Current status ('idle', 'searching', 'error', 'ready')
 * @property {string} errorMessage - Error message if any
 * @property {string} fullPageTextContent - Full text content of the page
 * @property {Array<Object>} pageIdentifiedElements - Array of identified elements
 */

/** @type {Object.<number, TabState>} */
const tabStates = {};

/**
 * Creates initial state for a new tab
 * @returns {TabState} Initial tab state
 */
export function createInitialTabState() {
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
 * Gets the state for a specific tab
 * @param {number} tabId - The ID of the tab
 * @returns {TabState|undefined} The tab state or undefined if not found
 */
export function getTabState(tabId) {
  return tabStates[tabId];
}

/**
 * Sets the state for a specific tab
 * @param {number} tabId - The ID of the tab
 * @param {TabState} state - The new state
 */
export function setTabState(tabId, state) {
  tabStates[tabId] = state;
}

/**
 * Updates a specific tab state property
 * @param {number} tabId - The ID of the tab
 * @param {string} property - The property to update
 * @param {any} value - The new value
 */
export function updateTabStateProperty(tabId, property, value) {
  if (tabStates[tabId]) {
    tabStates[tabId][property] = value;
  }
}

/**
 * Adds a message to the chat history of a tab
 * @param {number} tabId - The ID of the tab
 * @param {Object} message - The message to add
 */
export function addChatMessage(tabId, message) {
  if (tabStates[tabId]) {
    tabStates[tabId].chatHistory.push(message);
  }
}

/**
 * Updates the cited sentences for a tab
 * @param {number} tabId - The ID of the tab
 * @param {Array<Object>} citedSentences - The new cited sentences
 */
export function updateCitedSentences(tabId, citedSentences) {
  if (tabStates[tabId]) {
    tabStates[tabId].citedSentences = citedSentences;
    tabStates[tabId].currentCitedSentenceIndex =
      citedSentences.length > 0 ? 0 : -1;
  }
}

/**
 * Updates the current cited sentence index for a tab
 * @param {number} tabId - The ID of the tab
 * @param {number} index - The new index
 */
export function updateCurrentCitedSentenceIndex(tabId, index) {
  if (tabStates[tabId]) {
    tabStates[tabId].currentCitedSentenceIndex = index;
  }
}

/**
 * Updates the page content for a tab
 * @param {number} tabId - The ID of the tab
 * @param {string} content - The page content
 * @param {Array<Object>} elements - The identified elements
 */
export function updatePageContent(tabId, content, elements) {
  if (tabStates[tabId]) {
    tabStates[tabId].fullPageTextContent = content;
    tabStates[tabId].pageIdentifiedElements = elements;
  }
}

/**
 * Updates the status and error message for a tab
 * @param {number} tabId - The ID of the tab
 * @param {string} status - The new status
 * @param {string} [errorMessage=""] - The error message if any
 */
export function updateTabStatus(tabId, status, errorMessage = "") {
  if (tabStates[tabId]) {
    tabStates[tabId].status = status;
    tabStates[tabId].errorMessage = errorMessage;
  }
}

/**
 * Removes a tab's state
 * @param {number} tabId - The ID of the tab to remove
 */
export function removeTabState(tabId) {
  delete tabStates[tabId];
}

/**
 * Gets all tab states
 * @returns {Object.<number, TabState>} All tab states
 */
export function getAllTabStates() {
  return tabStates;
}

// Export the tabStates object for direct access if needed
export { tabStates };
