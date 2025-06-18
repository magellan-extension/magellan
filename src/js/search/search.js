/**
 * @module search
 * @description Provides AI-powered search functionality for web pages, including content relevance checking
 * and LLM-based search with citation support. This module handles both page-specific and general knowledge searches.
 *
 * @typedef {Object} Citation
 * @property {string} text - The text content of the cited element
 * @property {string} elementId - The unique ID of the element (e.g., "mgl-node-0")
 * @property {string} id - Unique citation ID in format "citation-{tabId}-{timestamp}-{index}"
 * @property {number} originalIndexInLlmResponse - Original position in LLM's citation list
 *
 * @typedef {Object} SearchOptions
 * @property {boolean} [forceGeneralKnowledge=false] - Forces general knowledge search mode
 *
 * Search Modes:
 * - "page": Only searches within page content
 * - "general": Uses general knowledge only
 * - "blended": Combines page content with general knowledge
 *
 * The search process:
 * 1. Validates tab state and content availability
 * 2. Checks content relevance (unless in general knowledge mode)
 * 3. Generates AI response based on search mode and relevance
 * 4. Processes citations and updates UI
 * 5. Handles element highlighting if enabled
 */

import {
  tabStates,
  getTabState,
  addChatMessage,
  updateCitedSentences,
  updateTabStatus,
} from "../state/tabState.js";
import {
  contentScript_highlightElementsById,
  contentScript_clearHighlightsAndIds,
  contentScript_extractAndIdRelevantElements,
} from "./contentScript.js";
import {
  SEARCH_MODE_STORAGE_KEY,
  currentActiveTabId,
  ai,
} from "../ui/sidebar.js";
import {
  navigateToMatchOnPage,
  renderPopupUI,
  refocusSearchInput,
} from "../ui/ui.js";
import { getCurrentFile, getCurrentFileContent } from "../ui/fileUpload.js";

/**
 * Checks if the page content is relevant to the query
 * @async
 * @param {string} query - User's search query
 * @param {string} pageContent - Content from the page
 * @returns {Promise<boolean>} Whether the page content is relevant
 */

export async function isPageContentRelevant(query, pageContent) {
  const relevancePrompt = `
  You are an AI assistant helping determine if a webpage's content is relevant to a user's question.
  The user has asked: "${query}"
  
  Here is the content from the webpage:
  ${pageContent}
  
  Please determine if the webpage content is relevant to answering the user's question.
  Respond with ONLY "RELEVANT" or "NOT_RELEVANT".
  `;

  try {
    const result = await ai.generateContent(relevancePrompt);
    const response = result.text.trim().toUpperCase();
    return response === "RELEVANT";
  } catch (error) {
    console.error("Error checking content relevance:", error);
    return false;
  }
}

/**
 * Performs the AI-powered search on page content
 * @async
 * @param {string} query - User's search query
 * @param {number} forTabId - ID of the tab to search in
 * @param {Object} [options={}] - Additional search options
 * @param {boolean} [options.forceGeneralKnowledge=false] - If true, forces a general knowledge search
 * @returns {Promise<void>}
 *
 * @throws {Error} If search fails or AI is not initialized
 */
export async function performLLMSearch(query, forTabId, options = {}) {
  const { forceGeneralKnowledge = false } = options;
  const state = getTabState(forTabId);

  // Get current search mode
  const { [SEARCH_MODE_STORAGE_KEY]: searchMode } =
    await chrome.storage.local.get([SEARCH_MODE_STORAGE_KEY]);
  let isGeneralKnowledgeMode =
    searchMode === "general" || forceGeneralKnowledge;

  // Get the last 10 messages from chat history for context
  const recentMessages = state.chatHistory.slice(-10);
  const conversationContext = recentMessages
    .map(
      (msg) => `${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}`
    )
    .join("\n\n");

  if (!state) {
    if (state) {
      updateTabStatus(
        forTabId,
        "error",
        "Page content not available for LLM search."
      );
      addChatMessage(forTabId, {
        role: "assistant",
        content: `Error: Page content not available for LLM search.`,
      });
    }
    if (currentActiveTabId === forTabId) renderPopupUI();
    return;
  }

  // Only require page content for non-general knowledge modes
  if (
    !isGeneralKnowledgeMode &&
    !state.pageIdentifiedElements.length &&
    !state.fullPageTextContent
  ) {
    updateTabStatus(
      forTabId,
      "error",
      "Page content not available for LLM search."
    );
    addChatMessage(forTabId, {
      role: "assistant",
      content: `Error: Page content not available for LLM search.`,
    });
    if (currentActiveTabId === forTabId) renderPopupUI();
    return;
  }

  try {
    // Skip relevance check if forcing general knowledge or in general knowledge mode
    const isRelevant = isGeneralKnowledgeMode
      ? false
      : await isPageContentRelevant(query, state.fullPageTextContent);

    let llmResult;
    if (isGeneralKnowledgeMode) {
      // General Knowledge Only mode
      const webPrompt = `
You are an AI assistant helping a user with their question. Please use your general knowledge, reasoning capabilities, and conversation history to provide a helpful answer.

Recent conversation history:
${conversationContext}

User's question: "${query}"

Please provide a clear and informative answer. If you're uncertain about any part of your response, please indicate that. Keep your answer concise and to the point.

Format your response as follows:
LLM_ANSWER_START
[Your answer to the query]
LLM_ANSWER_END
LLM_CITATIONS_START
NONE
LLM_CITATIONS_END
`;
      llmResult = await ai.generateContent(webPrompt);
    } else if (searchMode === "page" && !isRelevant) {
      // Page Context Only mode - no relevant content found
      llmResult = {
        text: `LLM_ANSWER_START
  I apologize, but I cannot find any relevant information on this page to answer your question. You can try searching with general knowledge by changing the search mode or clicking the button below.
  
  LLM_ANSWER_END
  LLM_CITATIONS_START
  NONE
  LLM_CITATIONS_END`,
      };
    } else if (searchMode === "blended" && !isRelevant) {
      // Blended mode - fallback to general knowledge
      const webPrompt = `
You are an AI assistant helping a user with their question. Please use your general knowledge, reasoning capabilities, and conversation history to provide a helpful answer.

Recent conversation history:
${conversationContext}

User's question: "${query}"

Please provide a clear and informative answer. If you're uncertain about any part of your response, please indicate that. Keep your answer concise and to the point.

Format your response as follows:
LLM_ANSWER_START
[Your answer to the query]
LLM_ANSWER_END
LLM_CITATIONS_START
NONE
LLM_CITATIONS_END
`;
      llmResult = await ai.generateContent(webPrompt);
      isGeneralKnowledgeMode = true;
    } else {
      // Page Context mode with relevant content or Blended mode with relevant content
      const pagePrompt = `
You are an AI assistant helping a user with their question about a web page. Please use the page content and conversation history to provide a helpful answer.

Recent conversation history:
${conversationContext}

Page content:
${state.fullPageTextContent}

User's question: "${query}"

Please provide a clear and informative answer based on the page content and conversation history. If you're uncertain about any part of your response, please indicate that. Keep your answer concise and to the point.

Format your response as follows:
LLM_ANSWER_START
[Your answer to the query]
LLM_ANSWER_END
LLM_CITATIONS_START
[List of element IDs to cite, one per line, or NONE if no citations]
LLM_CITATIONS_END
`;
      llmResult = await ai.generateContent(pagePrompt);
    }

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

    // Clean the assistant response text by removing any node IDs
    const assistantResponseText = answerMatch
      ? answerMatch[1].trim()
      : "LLM did not provide an answer in the expected format. Please try again.";
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

    // Only add the response if it's not a duplicate
    const lastMessage = state.chatHistory[state.chatHistory.length - 1];
    const isDuplicate =
      lastMessage &&
      lastMessage.role === "assistant" &&
      lastMessage.content === assistantResponseText;

    if (!isDuplicate) {
      updateCitedSentences(forTabId, currentCitationsForThisResponse);
      addChatMessage(forTabId, {
        role: "assistant",
        content: assistantResponseText,
        citations: currentCitationsForThisResponse,
        isExternalSource: isGeneralKnowledgeMode,
      });

      // If this is a general knowledge answer, collapse citations
      if (isGeneralKnowledgeMode) {
        // Collapse citations section
        if (currentActiveTabId === forTabId) {
          document.getElementById("citationsTitle")?.classList.add("collapsed");
          document
            .getElementById("citationsContentWrapper")
            ?.classList.add("collapsed");
          await chrome.storage.local.set({ citationsCollapsed: true });
        }
      }
    }

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

    updateTabStatus(forTabId, "ready");
    if (currentActiveTabId === forTabId) {
      renderPopupUI();
    }
  } catch (error) {
    console.error("LLM Search Error:", error);
    if (tabStates[forTabId]) {
      updateTabStatus(
        forTabId,
        "error",
        `LLM request error: ${error.message || error.toString()}`
      );
      addChatMessage(forTabId, {
        role: "assistant",
        content: `Error: LLM request error: ${
          error.message || error.toString()
        }`,
      });
      if (currentActiveTabId === forTabId) renderPopupUI();
    }
  }
}

/**
 * Checks if the current page is a PDF
 * @async
 * @param {number} tabId - The ID of the tab to check
 * @returns {Promise<boolean>} Whether the page is a PDF
 */
async function isPDFPage(tabId) {
  try {
    const tabs = await chrome.tabs.get(tabId);
    const url = tabs.url || "";
    return url.toLowerCase().endsWith(".pdf");
  } catch (error) {
    console.error("Error checking if page is PDF:", error);
    return false;
  }
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
export async function handleSearch() {
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
    // Refocus search input for better UX
    refocusSearchInput();
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

  // Check if there's an uploaded file
  const uploadedFile = getCurrentFile();
  const uploadedFileContent = getCurrentFileContent();

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

  // If we have an uploaded file, use it as page context
  if (uploadedFile && uploadedFileContent) {
    state.status = "querying_llm";
    state.errorMessage = "";
    state.citedSentences = [];
    state.currentCitedSentenceIndex = -1;
    state.pageIdentifiedElements = [];
    state.fullPageTextContent = uploadedFileContent;
    renderPopupUI();
    await performLLMSearch(query, tabIdForSearch);
    return;
  }

  // Check if the current page is a PDF
  const isPDF = await isPDFPage(tabIdForSearch);
  if (isPDF && !isGeneralKnowledgeMode) {
    state.status = "error";
    state.errorMessage =
      "This appears to be a PDF page. Please upload the PDF document using the upload button.";
    state.chatHistory.push({
      role: "assistant",
      content: `This appears to be a PDF page. For better results, please upload the PDF document using the upload button. You can also switch to "General Knowledge Only" mode to ask questions without page context.`,
    });
    if (currentActiveTabId === tabIdForSearch) renderPopupUI();
    return;
  }

  // Otherwise, extract content from the current page
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
