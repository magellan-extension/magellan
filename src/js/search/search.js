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
 * Checks if the page content is relevant to the subject of the chat history and query
 * @async
 * @param {string} query - User's search query
 * @param {string} pageContent - Content from the page
 * @param {Array<Object>} chatHistory - Recent chat history (array of messages with {role, content})
 * @returns {Promise<boolean>} Whether the page content is relevant
 */
export async function isPageContentRelevant(query, pageContent, chatHistory) {
  // Use the last 4 messages for focused pronoun resolution.
  const recentMessages = chatHistory.slice(-4);
  const conversationContext = recentMessages
    .map(
      (msg) => `${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}`
    )
    .join("\n\n");

  console.log("Relevance Check Context:\n", conversationContext);
  console.log("Relevance Check Query:", query);

  const relevancePrompt = `
You are a highly precise, logical AI engine. Your goal is to determine if a webpage is relevant to a user's question by first identifying the definitive subject of the conversation. Follow these steps meticulously.

## LOGICAL STEPS

**1. Isolate the Subject from the Conversation:**
   - First, examine the "User's current question".
   - If the question names a specific subject (e.g., "who is ronaldo", "what is photosynthesis"), that is the **Final Subject**.
   - If the question uses a pronoun (e.g., "he", "she", "it", "his"), you MUST determine what it refers to based *only* on the "Recent chat history".
   - **CRITICAL RULE:** The most recent named person or thing in the conversation is the antecedent. For example, if the last assistant message was about "LeBron James", and the user asks "how old is he", the **Final Subject** is "LeBron James".
   - **DO NOT** use the "Webpage content" to influence your decision for the Final Subject. This step is about the conversation ONLY.

**2. Compare the Final Subject to the Webpage:**
   - Once you have determined the **Final Subject** from Step 1, you will then analyze the "Webpage content".
   - Ask yourself: "Is this webpage primarily about the Final Subject?" A brief mention is not enough.

**3. Output the Verdict:**
   - If the webpage is primarily about the **Final Subject**, your output must be ONLY "RELEVANT".
   - If the webpage is NOT about the **Final Subject**, your output must be ONLY "NOT_RELEVANT".

---
## EXAMPLES

**Example 1: Pronoun follows a new subject (your failing case)**
- Chat History: "...Assistant: LeBron James is an American professional basketball player..."
- Current Question: "how old is he"
- Webpage Content: A biography of Lionel Messi.
- **Thought Process:**
    1.  The question "how old is he" uses a pronoun.
    2.  I look at the chat history. The most recent subject mentioned is "LeBron James".
    3.  Therefore, the **Final Subject** is "LeBron James".
    4.  I now look at the Webpage Content. It is about "Lionel Messi".
    5.  "Lionel Messi" is not "LeBron James". The page is not relevant.
- **Output:** NOT_RELEVANT

**Example 2: Pronoun refers to page subject (correct case)**
- Chat History: "...Assistant: He is Lionel Messi..."
- Current Question: "how old is he"
- Webpage Content: A biography of Lionel Messi.
- **Thought Process:**
    1.  The question "how old is he" uses a pronoun.
    2.  I look at the chat history. The most recent subject mentioned is "Lionel Messi".
    3.  Therefore, the **Final Subject** is "Lionel Messi".
    4.  I now look at the Webpage Content. It is about "Lionel Messi".
    5.  The Final Subject and the page content match. The page is relevant.
- **Output:** RELEVANT

**Example 3: Explicit new subject (working case)**
- Chat History: "...Assistant: He is Lionel Messi..."
- Current Question: "who is ronaldo"
- Webpage Content: A biography of Lionel Messi.
- **Thought Process:**
    1.  The question explicitly names the subject "ronaldo".
    2.  Therefore, the **Final Subject** is "Ronaldo".
    3.  I now look at the Webpage Content. It is about "Lionel Messi".
    4.  "Lionel Messi" is not "Ronaldo". The page is not relevant.
- **Output:** NOT_RELEVANT

---
## YOUR TURN

**Recent chat history:**
${conversationContext}

**User's current question:** "${query}"

**Webpage content (summary):**
${pageContent.substring(0, 4000)}

**Your decision (output ONLY "RELEVANT" or "NOT_RELEVANT"):**
`;

  try {
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
    let isRelevant = false;
    if (isGeneralKnowledgeMode) {
      isRelevant = false;
    } else if (searchMode === "blended") {
      isRelevant = await isPageContentRelevant(
        query,
        state.fullPageTextContent,
        state.chatHistory
      );
    } else if (searchMode === "page") {
      // In page mode, always assume relevant (skip check)
      isRelevant = true;
    }

    let llmResult;
    if (isGeneralKnowledgeMode || (searchMode === "blended" && !isRelevant)) {
      // General Knowledge Only mode or blended without relevancy
      const webPrompt = `
You are an AI assistant helping a user with their question. Please use your general knowledge, reasoning capabilities, and conversation history to provide a helpful answer. Format your answers like you are responding to the user.

IMPORTANT: If the previous conversation included answers that said information was not found on the page, IGNORE those previous answers. Do NOT assume the answer is unknown just because it was not found on the page. Use your own general knowledge to answer the user's question as best as possible, even if previous answers were incomplete or negative.

Fact-check and verify any previous answers. If you know the correct information, display it, regardless of what the page or previous answers might have said.

Recent conversation history (for context, but do not let previous 'not found' answers limit you):
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
    } else {
      // Page Context mode with relevant content or Blended mode with relevant content
      const pagePrompt = `
You are an intelligent AI assistant. Your primary goal is to help a user by leveraging the content of a web page. You must skillfully combine the information on the page with your own reasoning and language capabilities to provide comprehensive and useful answers.

## CORE INSTRUCTIONS

**1. Understand the User's Request:** First, carefully analyze the user's question: "${query}". Determine if they are asking for specific facts, a summary, an analysis, or a creative task (like drafting an email or a social media post).

**2. Use Page Content as Your Fact Base:** The "PAGE CONTENT" provided below is your primary source of truth. Ground your answers in the information available on the page.
    - For factual questions (e.g., "What year was this company founded?"), extract the answer directly from the text.
    - For tasks (e.g., "Draft an outreach email to the person on this page"), use details from the page (like their name, title, company, recent achievements) to inform the content you generate. You should use your general knowledge of how to perform the task (e.g., email structure) but populate it with data from the page.

**3. Synthesize, Don't Just Repeat:** Do not simply copy-paste large chunks of text. Provide a concise, well-written response in your own words that directly addresses the user's request. If the page does not contain the information needed, clearly state that. For example: "I can't find their direct email address on this page, but here is a draft based on their role and company mentioned."

**4. CITE YOUR SOURCES (CRITICAL):**
    - You MUST cite the \`element_id\` for any specific facts, names, dates, or direct quotes you pull from the "PAGE CONTENT".
    - For creative tasks, cite the \`element_id\`s where you found the key pieces of information you used (e.g., the person's name, their job title).
    - List ONLY the element IDs (e.g., mgl-node-42), one ID per line, in the LLM_CITATIONS_START section.
    - If the answer cannot be found on the page or your response is purely generative without specific facts from the page, write "NONE" in the citations section.
    - **ABSOLUTELY DO NOT** include the \`[mgl-node-...]\` IDs anywhere inside the LLM_ANSWER_START ... LLM_ANSWER_END block. The answer for the user must be clean.

---
## CONTEXT

**Recent conversation history (use this to understand context and resolve pronouns like 'he', 'she', 'it'):**
${conversationContext}

**User's current question:** "${query}"

**PAGE CONTENT (Each chunk is preceded by its unique element ID, like [mgl-node-0]):**
--- START OF PAGE CONTENT ---
${state.fullPageTextContent}
--- END OF PAGE CONTENT ---

---
## YOUR RESPONSE FORMAT

**IMPORTANT: Your entire response MUST follow this exact format. Do not add any other text outside these blocks.**

LLM_ANSWER_START
[Your synthesized, well-written, and CLEAN answer to the user's query. It must not contain any [mgl-node-...] IDs.]
LLM_ANSWER_END
LLM_CITATIONS_START
[mgl-node-id_of_cited_element_1]
[mgl-node-id_of_cited_element_2]
...
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

    // Get the raw answer, then GUARANTEE it's clean for the user display.
    // This defensively removes any [mgl-node-...] tags that the LLM might have mistakenly included in the answer block.
    const assistantResponseText = answerMatch
      ? answerMatch[1].replace(
          /\s*\[\s*mgl-node-\d+(?:\s*,\s*mgl-node-\d+)*\s*\]/g,
          ""
        ) // Remove any leading space and [mgl-node-...] tags
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
