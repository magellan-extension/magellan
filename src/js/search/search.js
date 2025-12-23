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

const MCP_MAX_ATTEMPTS = 4;
const MCP_RETRY_BASE_DELAY_MS = 250;

/**
 * Simple async wait helper for MCP retries.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Builds the full MCP prompt by appending deterministic response rules.
 * @param {string} basePrompt - The main task-specific prompt
 * @param {Object} options
 * @param {"general"|"page"|"blended"} options.mode - The active search mode
 * @param {boolean} options.requireCitations - Whether citations are required
 * @param {number} options.attempt - Current attempt count
 * @returns {string} Prompt with MCP instructions appended
 */
function buildMcpPrompt(basePrompt, { mode, requireCitations, attempt }) {
  const citationDirective = requireCitations
    ? `- Populate the "citations" array with only the element IDs (e.g., "mgl-node-4") that directly support the answer. Order them by how they appear in the answer. If no element applies, return an empty array.`
    : `- Return an empty array for "citations".`;

  const attemptReminder =
    attempt > 0
      ? `\nWARNING: Your previous response violated MCP. Return valid JSON that follows the schema exactly. No commentary or markdown.`
      : "";

  return `${basePrompt}

MAGELLAN CONTROL PROTOCOL (MCP)

Respond with VALID JSON only (no markdown fences, no prose). The JSON must follow this schema:
{
  "answer": "string",
  "citations": ["mgl-node-#"...],
  "mode": "${mode}",
  "confidence": "high" | "medium" | "low"
}

- "answer" must be a standalone response with no element IDs or bracketed citations.
${citationDirective}
- "confidence" reflects how certain you are ("high", "medium", or "low").
- Do not add extra keys.
${attemptReminder}`.trim();
}

/**
 * Attempts to parse a JSON object from an LLM response, even if the model added prose.
 * @param {string} rawText
 * @returns {Object}
 */
function extractJsonFromText(rawText) {
  if (!rawText) throw new Error("Empty LLM response.");
  const trimmed = rawText.trim();
  try {
    return JSON.parse(trimmed);
  } catch (_) {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      const possibleJson = trimmed.slice(start, end + 1);
      return JSON.parse(possibleJson);
    }
    throw new Error("Unable to locate JSON payload in LLM response.");
  }
}

/**
 * Normalizes the MCP payload into a predictable structure.
 * @param {string} rawText
 * @returns {{answer: string, citations: string[], mode: string, confidence: string}}
 */
function normalizeMcpPayload(rawText) {
  const parsed = extractJsonFromText(rawText);
  const answer = typeof parsed.answer === "string" ? parsed.answer.trim() : "";
  if (!answer) {
    throw new Error("MCP response missing 'answer'.");
  }

  const citations = Array.isArray(parsed.citations)
    ? parsed.citations
        .map((id) => (typeof id === "string" ? id.trim() : ""))
        .filter((id) => id.length > 0)
    : [];

  const mode = typeof parsed.mode === "string" ? parsed.mode.trim() : "page";
  const confidence =
    typeof parsed.confidence === "string"
      ? parsed.confidence.trim().toLowerCase()
      : "medium";

  return { answer, citations, mode, confidence };
}

/**
 * Runs the MCP flow with retries to guarantee deterministic JSON responses.
 * @param {string} basePrompt
 * @param {Object} options
 * @param {"general"|"page"|"blended"} options.mode
 * @param {boolean} options.requireCitations
 * @returns {Promise<{answer: string, citations: string[], mode: string, confidence: string}>}
 */
async function runMcpCompletion(basePrompt, { mode, requireCitations }) {
  if (!ai) {
    throw new Error("AI client not initialized.");
  }

  let lastError;
  for (let attempt = 0; attempt < MCP_MAX_ATTEMPTS; attempt++) {
    try {
      const prompt = buildMcpPrompt(basePrompt, {
        mode,
        requireCitations,
        attempt,
      });
      // Update model with :online suffix if real-time is enabled
      const { getModelForRequest } = await import("../ui/sidebar.js");
      const modelForRequest = await getModelForRequest();
      ai.setModel(modelForRequest);

      const llmResult = await ai.generateContent(prompt);
      const llmRawResponse = llmResult.text ?? "";
      console.log("LLM Raw Response:", llmRawResponse);

      return normalizeMcpPayload(llmRawResponse);
    } catch (error) {
      lastError = error;
      console.warn(
        `Failed to get valid MCP response (attempt ${attempt + 1}):`,
        error.message || error
      );
      if (attempt < MCP_MAX_ATTEMPTS - 1) {
        const backoff = MCP_RETRY_BASE_DELAY_MS * (attempt + 1);
        await wait(backoff);
      }
    }
  }

  throw lastError || new Error("Unable to parse MCP response.");
}

/**
 * Checks if the page content is relevant to the subject of the chat history and query
 * @async
 * @param {string} query - User's search query
 * @param {string} pageContent - Content from the page
 * @param {Array<Object>} chatHistory - Recent chat history (array of messages with {role, content})
 * @returns {Promise<boolean>} Whether the page content is relevant
 */
export async function isPageContentRelevant(
  query,
  pageContent,
  chatHistory,
  isDocumentAttached
) {
  // Use the last 4 messages for focused pronoun resolution.
  const recentMessages = chatHistory.slice(-4);
  const conversationContext = recentMessages
    .map(
      (msg) => `${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}`
    )
    .join("\n\n");

  console.log("Relevance Check Context:\n", conversationContext);
  console.log("Relevance Check Query:", query);

  const sourceType = isDocumentAttached ? "uploaded document" : "webpage";
  const sourceLabel = isDocumentAttached ? "Document" : "Webpage";

  const relevancePrompt = `
You are a highly precise, logical AI engine. Your goal is to determine if the content from a ${sourceType} (referred to as the 'source') is relevant to a user's question. The variable isDocumentAttached = ${isDocumentAttached} indicates whether the content is from an uploaded document (true) or a webpage (false).

## INSTRUCTIONS

- If the user's question is about the source itself (e.g., "what is this document about?", "summarize this document", "what is this page about?", "summarize this page", etc.), you MUST consider the content RELEVANT.
- Otherwise, follow these steps:
  1. Isolate the subject of the user's question. If the question uses a pronoun (e.g., "he", "she", "it"), resolve it using only the recent chat history.
  2. Compare the subject to the source content:
     - If the source is primarily about the subject, your output must be ONLY "RELEVANT".
     - If the source is NOT about the subject, your output must be ONLY "NOT_RELEVANT".

## EXAMPLES

Example 1: User asks about the source itself
- isDocumentAttached: true
- User's question: "what is this document about?"
- Output: RELEVANT

Example 2: User asks about the source itself
- isDocumentAttached: false
- User's question: "what is this page about?"
- Output: RELEVANT

Example 3: Pronoun follows a new subject
- Chat History: "...Assistant: LeBron James is an American professional basketball player..."
- User's question: "how old is he"
- Source Content: A biography of Lionel Messi.
- Thought Process:
    1. The question "how old is he" uses a pronoun.
    2. The most recent subject mentioned is "LeBron James".
    3. The source content is about "Lionel Messi".
    4. "Lionel Messi" is not "LeBron James". The source is not relevant.
- Output: NOT_RELEVANT

Example 4: Pronoun refers to source subject
- Chat History: "...Assistant: He is Lionel Messi..."
- User's question: "how old is he"
- Source Content: A biography of Lionel Messi.
- Thought Process:
    1. The question "how old is he" uses a pronoun.
    2. The most recent subject mentioned is "Lionel Messi".
    3. The source content is about "Lionel Messi".
    4. The subject and the source content match. The source is relevant.
- Output: RELEVANT

Example 5: Explicit new subject
- Chat History: "...Assistant: He is Lionel Messi..."
- User's question: "who is ronaldo"
- Source Content: A biography of Lionel Messi.
- Thought Process:
    1. The question explicitly names the subject "ronaldo".
    2. The source content is about "Lionel Messi".
    3. "Lionel Messi" is not "Ronaldo". The source is not relevant.
- Output: NOT_RELEVANT

---

Recent chat history:
${conversationContext}

User's current question: "${query}"

Source content (summary):
${pageContent.substring(0, 4000)}

Your decision (output ONLY "RELEVANT" or "NOT_RELEVANT"): 
`;

  try {
    // Update model with :online suffix if real-time is enabled
    const { getModelForRequest } = await import("../ui/sidebar.js");
    const modelForRequest = await getModelForRequest();
    ai.setModel(modelForRequest);

    const result = await ai.generateContent(relevancePrompt);
    // Adding defensive trimming and handling of potential model verbosity.
    const response = result.text
      .trim()
      .toUpperCase()
      .replace(/[^A-Z_]/g, "");
    console.log("Relevance Check Raw Response:", result.text);
    console.log("Relevance Check Parsed Response:", response);
    // Final sanity check
    if (response !== "RELEVANT" && response !== "NOT_RELEVANT") {
      console.warn(
        `Unexpected relevance response: "${response}". Defaulting to NOT_RELEVANT.`
      );
      return false;
    }
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
  const { forceGeneralKnowledge = false, isDocumentAttached = false } = options;
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
    let isRelevant = false;
    if (isGeneralKnowledgeMode) {
      isRelevant = false;
    } else if (searchMode === "blended") {
      isRelevant = await isPageContentRelevant(
        query,
        state.fullPageTextContent,
        state.chatHistory,
        isDocumentAttached
      );
    } else if (searchMode === "page") {
      // In page mode, always assume relevant (skip check)
      isRelevant = true;
    }

    let llmResponse;
    if (isGeneralKnowledgeMode || (searchMode === "blended" && !isRelevant)) {
      // General Knowledge Only mode or blended without relevancy
      const webPrompt = `
You are an AI assistant named Magellan, helping a user with their question. Sometimes, the user may not enter a question or may just greet you or say something conversational. In those cases, respond in a friendly, conversational way—greet the user, offer help, or ask how you can assist, just like a helpful assistant.

Please use your general knowledge, reasoning capabilities, and conversation history to provide a helpful answer. Format your answers like you are responding to the user.

IMPORTANT: If the previous conversation included answers that said information was not found on the page, IGNORE those previous answers. Do NOT assume the answer is unknown just because it was not found on the page. Use your own general knowledge to answer the user's question as best as possible, even if previous answers were incomplete or negative.

Fact-check and verify any previous answers. If you know the correct information, display it, regardless of what the page or previous answers might have said.

Recent conversation history (for context, but do not let previous 'not found' answers limit you):
${conversationContext}

User's question: "${query}"

Please provide a clear and informative answer. If you're uncertain about any part of your response, please indicate that. Keep your answer concise and to the point.
`;
      llmResponse = await runMcpCompletion(webPrompt, {
        mode: "general",
        requireCitations: false,
      });
      isGeneralKnowledgeMode = true;
    } else if (searchMode === "page" && !isRelevant) {
      // Page Context Only mode - no relevant content found
      isGeneralKnowledgeMode = false; // Explicitly set to false for page context
      llmResponse = {
        answer: `I apologize, but I cannot find any relevant information on this page to answer your question. You can try searching with general knowledge by changing the search mode or clicking the button below.`,
        citations: [],
      };
    } else {
      // Page Context mode with relevant content or Blended mode with relevant content
      isGeneralKnowledgeMode = false; // Explicitly set to false for page context
      const pagePrompt = `
You are an intelligent AI assistant named Magellan. Sometimes, the user may not enter a question or may just greet you or say something conversational. In those cases, respond in a friendly, conversational way—greet the user, offer help, or ask how you can assist, just like a helpful assistant.

Your primary goal is to help a user by leveraging the content of a web page. You must skillfully combine the information on the page with your own reasoning and language capabilities to provide comprehensive and useful answers.

Do not place element IDs or citation brackets directly in the prose; MCP will collect citations separately.

## CORE INSTRUCTIONS

**1. Understand the User's Request:** First, carefully analyze the user's question: "${query}". Determine if they are asking for specific facts, a summary, an analysis, or a creative task (like drafting an email or a social media post).

**2. Use Page Content as Your Fact Base:** The "PAGE CONTENT" provided below is your primary source of truth. Ground your answers in the information available on the page.
    - For factual questions (e.g., "What year was this company founded?"), extract the answer directly from the text.
    - For tasks (e.g., "Draft an outreach email to the person on this page"), use details from the page (like their name, title, company, recent achievements) to inform the content you generate. You should use your general knowledge of how to perform the task (e.g., email structure) but populate it with data from the page.

**3. Synthesize, Don't Just Repeat:** Do not simply copy-paste large chunks of text. Provide a concise, well-written response in your own words that directly addresses the user's request. If the page does not contain the information needed, clearly state that. For example: "I can't find their direct email address on this page, but here is a draft based on their role and company mentioned."

**4. Cite Your Sources (CRITICAL):**
    - Reference the \`element_id\` (e.g., mgl-node-42) for any specific facts, names, dates, or direct quotes taken from the page.
    - If no page elements apply, explicitly state that in your reasoning and leave citations empty.

---
## CONTEXT

**Recent conversation history (use this to understand context and resolve pronouns like 'he', 'she', 'it'):**
${conversationContext}

**User's current question:** "${query}"

**PAGE CONTENT (Each chunk is preceded by its unique element ID, like [mgl-node-0]):**
--- START OF PAGE CONTENT ---
${state.fullPageTextContent}
--- END OF PAGE CONTENT ---
`;
      llmResponse = await runMcpCompletion(pagePrompt, {
        mode: searchMode === "blended" ? "blended" : "page",
        requireCitations: true,
      });
    }

    if (!tabStates[forTabId]) {
      console.log("Tab closed during LLM search for tab:", forTabId);
      return;
    }

    const assistantResponseText = (llmResponse.answer || "").replace(
      /\s*\[\s*mgl-node-\d+(?:\s*,\s*mgl-node-\d+)*\s*\]/g,
      ""
    ); // Defensive cleanup in case the model leaked citations

    // Deduplicate and filter overlapping citations
    const uniqueElementIds = [];
    const seenIds = new Set();
    const citationsArray = Array.isArray(llmResponse.citations)
      ? llmResponse.citations
      : [];
    for (const rawId of citationsArray) {
      const id = typeof rawId === "string" ? rawId.trim() : "";
      if (!id || id.toUpperCase() === "NONE" || !id.startsWith("mgl-node-"))
        continue;
      if (!seenIds.has(id)) {
        uniqueElementIds.push(id);
        seenIds.add(id);
      }
    }

    const currentCitationsForThisResponse = [];
    if (
      uniqueElementIds.length > 0 &&
      state.pageIdentifiedElements.length > 0
    ) {
      uniqueElementIds.forEach((elementId, index) => {
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

  // Switch to chat tab when user enters a search
  if (window.switchToChatTab) {
    window.switchToChatTab();
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
  let uploadedFileContent = getCurrentFileContent();
  let uploadedFileContextPrefix = "";
  if (uploadedFile && uploadedFileContent) {
    uploadedFileContextPrefix = `The following content is from an uploaded document named \"${uploadedFile.name}\".\n\n`;
    uploadedFileContent = uploadedFileContextPrefix + uploadedFileContent;
  }

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
    console.log(state.fullPageTextContent);
    renderPopupUI();
    await performLLMSearch(query, tabIdForSearch, { isDocumentAttached: true });
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
