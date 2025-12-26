/**
 * @module ui
 * @description Manages the UI rendering and interaction for the Magellan extension popup.
 * This module handles:
 * - Rendering the main popup interface
 * - Chat message display and formatting
 * - Citation management and navigation
 * - Status updates and notifications
 * - UI state management
 *
 * The module integrates with:
 * - sidebar.js for shared state (currentActiveTabId, ai)
 * - search.js for search functionality
 * - tabState.js for state management
 * - contentScript.js for page highlighting
 *
 * @requires chrome.scripting API for page manipulation
 * @requires chrome.storage API for settings
 */

import { parseMarkdown } from "../core/utils.js";
import { tabStates, getTabState } from "../state/tabState.js";
import {
  contentScript_highlightElementsById,
  contentScript_clearHighlightsAndIds,
} from "../search/contentScript.js";
import { performLLMSearch } from "../search/search.js";
import { currentActiveTabId, ai } from "./sidebar.js";
import { handleSearch } from "../search/search.js";

/**
 * @typedef {Object} ChatMessage
 * @property {string} role - 'user' or 'assistant'
 * @property {string} content - The text content of the message
 * @property {Array<import('./search.js').Citation>} [citations] - Citations for assistant messages
 * @property {boolean} [isExternalSource] - True if the answer is from general knowledge
 * @property {boolean} [gkPrompted] - True if "prompt with GK" was clicked for this message
 * @property {boolean} [isTyping] - True if the message is currently being typed out
 */

/**
 * @typedef {Object} Citation
 * @property {string} text - The text content of the cited element
 * @property {string} elementId - Unique identifier for the DOM element
 * @property {string} id - Unique citation ID
 * @property {number} index - Index in the citations list
 */

/**
 * Renders the main popup UI based on current state
 * @function
 * @description Updates all UI elements including:
 * - Chat history with message formatting
 * - Citations with navigation
 * - Search status and notifications
 * - Navigation controls
 * - Settings state
 *
 * This is the main UI update function that should be called whenever
 * the application state changes.
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
  if (searchQueryEl) {
    const wasDisabled = searchQueryEl.disabled;
    searchQueryEl.disabled = isLoading;

    // Refocus search input when it's re-enabled after a search
    if (wasDisabled && !isLoading && state.status === "ready") {
      refocusSearchInput();
    }
  }

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
 * Refocuses the search input field for better UX
 * @function
 * @description
 * Brings focus back to the search input after a search completes,
 * allowing users to easily continue typing without manual navigation.
 */
export function refocusSearchInput() {
  const searchQueryEl = document.getElementById("searchQuery");
  if (searchQueryEl) {
    searchQueryEl.focus();
  }
}

/**
 * Creates a typing animation for assistant messages
 * @function
 * @param {HTMLElement} contentDiv - The content div to animate
 * @param {string} fullContent - The complete content to type out
 * @param {number} [speed=15] - Base milliseconds between characters
 * @returns {Promise<void>}
 */
async function typeMessage(contentDiv, fullContent, speed = 15) {
  contentDiv.innerHTML = '<span class="typing-cursor">|</span>';

  let currentIndex = 0;
  const totalLength = fullContent.length;
  let lastScrollTime = 0;
  const scrollThrottle = 100;
  let finished = false;

  // Set a 10-second timeout to show the full message if not done
  const forceShowTimeout = setTimeout(() => {
    if (!finished) {
      finished = true;
      const cursor = contentDiv.querySelector(".typing-cursor");
      if (cursor) cursor.remove();
      contentDiv.innerHTML = parseMarkdown(fullContent);
      const chatLogContainer = document.getElementById("chatLogContainer");
      if (chatLogContainer) {
        chatLogContainer.scrollTop = chatLogContainer.scrollHeight;
      }
      refocusSearchInput();
    }
  }, 10000);

  const typeNextChunk = () => {
    if (finished) return;
    if (currentIndex >= totalLength) {
      finished = true;
      clearTimeout(forceShowTimeout);
      // Remove cursor when done
      const cursor = contentDiv.querySelector(".typing-cursor");
      if (cursor) cursor.remove();

      contentDiv.innerHTML = parseMarkdown(fullContent);

      // Scroll to bottom after typing is complete (instant for immediate visibility)
      const chatLogContainer = document.getElementById("chatLogContainer");
      if (chatLogContainer) {
        chatLogContainer.scrollTop = chatLogContainer.scrollHeight;
      }

      refocusSearchInput();

      return;
    }

    // Determine chunk size (3-10 characters)
    const chunkSize = 3 + Math.floor(Math.random() * 8); // Random between 3-10
    const remainingLength = totalLength - currentIndex;
    const actualChunkSize = Math.min(chunkSize, remainingLength);

    // Get the chunk of text
    const chunk = fullContent.substring(
      currentIndex,
      currentIndex + actualChunkSize
    );
    const cursor = contentDiv.querySelector(".typing-cursor");
    if (cursor) {
      cursor.insertAdjacentText("beforebegin", chunk);
    }
    currentIndex += actualChunkSize;

    // Scroll to bottom during typing (throttled to avoid performance issues)
    const now = Date.now();
    if (now - lastScrollTime > scrollThrottle) {
      const chatLogContainer = document.getElementById("chatLogContainer");
      if (chatLogContainer) {
        chatLogContainer.scrollTo({
          top: chatLogContainer.scrollHeight,
          behavior: "smooth",
        });
      }
      lastScrollTime = now;
    }

    // Calculate delay - faster for chunks, with pauses at punctuation
    const lastChar = chunk[chunk.length - 1];
    let finalDelay = speed * 0.3; // Much faster since we're typing chunks

    if (lastChar === "." || lastChar === "!" || lastChar === "?") {
      finalDelay += 80; // Extra pause at sentence endings
    } else if (lastChar === "," || lastChar === ";") {
      finalDelay += 40; // Smaller pause at commas
    } else if (lastChar === " " && Math.random() < 0.2) {
      finalDelay += 20; // Occasional pause at spaces
    }

    finalDelay = Math.max(10, finalDelay); // Minimum delay

    setTimeout(typeNextChunk, finalDelay);
  };

  typeNextChunk();
}

/**
 * Renders the chat conversation history
 * @function
 * @param {Array<ChatMessage>} chatHistory - Chat messages to display
 * @param {string} currentStatus - Current search status ('idle', 'searching', 'error', etc.)
 * @description
 * Renders the chat interface with:
 * - User and assistant messages
 * - Message formatting and styling
 * - General knowledge prompts
 * - Citation handling
 * - Loading indicators
 * - Typing animations for assistant messages
 */
function renderChatLog(chatHistory, currentStatus) {
  const chatLogContainer = document.getElementById("chatLogContainer");
  if (!chatLogContainer) return;
  chatLogContainer.innerHTML = "";

  // Show suggestions if chat is empty
  if (chatHistory.length === 0) {
    renderChatSuggestions(chatLogContainer);
    return;
  }

  chatHistory.forEach((msg, index) => {
    const messageDiv = document.createElement("div");
    messageDiv.classList.add("chat-message");
    messageDiv.classList.add(
      msg.role === "user" ? "user-message" : "assistant-message"
    );

    if (msg.role === "assistant") {
      // Check if this is an error message
      if (msg.content && msg.content.startsWith("Error:")) {
        messageDiv.classList.add("error-message");
      } else {
        // Add source indicator classes
        if (msg.isExternalSource) {
          messageDiv.classList.add("general-knowledge");
        } else {
          if (msg.citations && msg.citations.length > 0) {
            messageDiv.classList.add("has-citations");
          }
        }
      }
    }

    // Add source header for assistant messages
    if (msg.role === "assistant") {
      const headerDiv = document.createElement("div");
      headerDiv.className = "message-source-header";

      if (msg.content?.startsWith("Error:")) {
        // Error message header
        headerDiv.textContent = "Error";
        headerDiv.style.color = "var(--error)";
      } else if (msg.isExternalSource) {
        // General knowledge header
        headerDiv.textContent = "Answer from general knowledge";
        headerDiv.style.color = "var(--success)";
      } else {
        // Page context header
        headerDiv.textContent = "Answer from page context";
        headerDiv.style.color = "var(--primary)";
      }

      messageDiv.appendChild(headerDiv);
    }

    const contentDiv = document.createElement("div");
    contentDiv.style.wordBreak = "break-word";

    if (msg.role === "assistant") {
      // Check if this message should be animated (is the last assistant message and not already typed)
      const isLastAssistantMessage = chatHistory
        .slice(index + 1)
        .every((m) => m.role === "user");

      if (
        isLastAssistantMessage &&
        !msg.isTyping &&
        currentStatus === "ready"
      ) {
        // Mark as typing and start animation
        msg.isTyping = true;
        // Small delay before starting to type, like ChatGPT
        setTimeout(() => {
          typeMessage(contentDiv, msg.content);
        }, 300);
      } else {
        // Already typed or not the last message, show full content
        contentDiv.innerHTML = parseMarkdown(msg.content);
      }
    } else {
      contentDiv.style.whiteSpace = "pre-wrap";
      contentDiv.textContent = msg.content;
    }

    messageDiv.appendChild(contentDiv);

    // Add action buttons for all assistant messages
    if (msg.role === "assistant") {
      // Create action row with gen knowledge button and icons
      const actionRow = document.createElement("div");
      actionRow.className = "message-action-row";

      // Add "Use gen knowledge" button for page-context answers
      // Don't show for error messages
      if (
        !msg.isExternalSource &&
        !msg.gkPrompted &&
        !msg.content?.startsWith("Error:") &&
        chatHistory[index - 1]?.role === "user"
      ) {
        const originalQuery = chatHistory[index - 1].content;
        const generalKnowledgeButton = document.createElement("button");
        generalKnowledgeButton.className = "general-knowledge-prompt-button";
        generalKnowledgeButton.innerHTML = `
          <div class="spinner"></div>
          <span>Use General Knowledge</span>
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 12h14M12 5l7 7-7 7"/>
          </svg>
        `;
        generalKnowledgeButton.addEventListener("click", async (event) => {
          event.stopPropagation();

          const state = tabStates[currentActiveTabId];
          if (!state || !ai || state.status === "querying_llm") return;

          const messageInHistory = state.chatHistory[index];
          if (messageInHistory) {
            messageInHistory.gkPrompted = true;
          }

          generalKnowledgeButton.disabled = true;
          generalKnowledgeButton.classList.add("loading");

          // Temporarily hide highlights by removing highlight classes
          await chrome.scripting.executeScript({
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

          // Collapse citations section
          document.getElementById("citationsTitle")?.classList.add("collapsed");
          document
            .getElementById("citationsContentWrapper")
            ?.classList.add("collapsed");
          await chrome.storage.local.set({ citationsCollapsed: true });

          // Clear cited sentences from state
          state.citedSentences = [];
          state.currentCitedSentenceIndex = -1;

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
              errorState.errorMessage =
                "Failed to get general knowledge answer.";
              renderPopupUI();
            }
          } finally {
            // Remove loading state when done
            generalKnowledgeButton.classList.remove("loading");
            generalKnowledgeButton.disabled = false;
          }
        });

        actionRow.appendChild(generalKnowledgeButton);
      }

      // Add icons container
      const buttonContainer = document.createElement("div");
      buttonContainer.className = "message-action-buttons";

      // Add copy button first
      const copyButton = document.createElement("button");
      copyButton.className = "copy-message-button";
      copyButton.title = "Copy";
      copyButton.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      `;

      // Add citations button second if message has citations
      if (msg.citations && msg.citations.length > 0) {
        const citationsButton = document.createElement("button");
        citationsButton.className = "citations-message-button";
        citationsButton.title = "View Citations";
        citationsButton.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/>
          </svg>
        `;

        citationsButton.addEventListener("click", async (event) => {
          event.stopPropagation();

          if (currentActiveTabId && tabStates[currentActiveTabId]) {
            const state = tabStates[currentActiveTabId];

            // Set citations and switch to citations tab
            state.citedSentences = msg.citations;
            state.currentCitedSentenceIndex = 0;

            // Switch to citations tab
            if (window.switchToCitationsTab) {
              window.switchToCitationsTab();
            }

            const { highlightsVisible } = await chrome.storage.local.get([
              "highlightsVisible",
            ]);

            // Re-add highlight styles and show highlights
            await chrome.scripting.insertCSS({
              target: { tabId: currentActiveTabId },
              css: `
                .mgl-cited-element-highlight { background-color: var(--highlight-bg, rgba(139, 139, 255, 0.4)) !important; color: inherit !important; border-radius: 3px; padding: 0.1em 0.2em; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
                .mgl-active-element-highlight { outline: 2px solid var(--primary, #8b8bff) !important; outline-offset: 2px !important; box-shadow: 0 0 8px rgba(139, 139, 255, 0.6) !important; }
              `,
            });

            if (highlightsVisible) {
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
          }
        });

        buttonContainer.appendChild(copyButton);
        buttonContainer.appendChild(citationsButton);
      } else {
        buttonContainer.appendChild(copyButton);
      }

      // Store original HTML for restoration
      const originalHTML = copyButton.innerHTML;

      copyButton.addEventListener("click", async (event) => {
        event.stopPropagation();

        try {
          // Get the plain text content (not HTML)
          const textToCopy = msg.content;
          await navigator.clipboard.writeText(textToCopy);

          // Visual feedback - show checkmark
          copyButton.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M20 6L9 17L4 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          `;
          copyButton.style.color = "var(--success)";

          // Restore after 2 seconds
          setTimeout(() => {
            copyButton.innerHTML = originalHTML;
            copyButton.style.color = "";
          }, 2000);
        } catch (err) {
          console.error("Failed to copy text:", err);
          // Restore on error too
          copyButton.innerHTML = originalHTML;
          copyButton.style.color = "";
        }
      });

      actionRow.appendChild(buttonContainer);

      messageDiv.appendChild(actionRow);
    }

    if (msg.role === "assistant" && msg.citations && msg.citations.length > 0) {
      messageDiv.classList.add("has-citations");
    }

    chatLogContainer.appendChild(messageDiv);
  });

  if (currentStatus === "querying_llm") {
    const loadingDiv = document.createElement("div");
    loadingDiv.className = "chat-message assistant-message loading-dots";
    loadingDiv.innerHTML = "<span></span><span></span><span></span>";
    chatLogContainer.appendChild(loadingDiv);
  }

  chatLogContainer.scrollTo({
    top: chatLogContainer.scrollHeight,
    behavior: "smooth",
  });

  // Refocus search input if we're in ready state and this is the last assistant message
  if (currentStatus === "ready" && chatHistory.length > 0) {
    const lastMessage = chatHistory[chatHistory.length - 1];
    if (lastMessage.role === "assistant" && !lastMessage.isTyping) {
      refocusSearchInput();
    }
  }
}

/**
 * Renders suggestion questions in the chat container
 * @function
 * @param {HTMLElement} container - The chat log container element
 */
function renderChatSuggestions(container) {
  const suggestionsContainer = document.createElement("div");
  suggestionsContainer.className = "chat-suggestions-container";
  suggestionsContainer.id = "chatSuggestionsContainer";

  const title = document.createElement("div");
  title.className = "chat-suggestions-title";
  title.textContent = "Try asking:";
  suggestionsContainer.appendChild(title);

  const questionsContainer = document.createElement("div");
  questionsContainer.className = "suggestion-questions";

  // Pool of suggestion questions - mix of page-specific and general questions
  const SUGGESTION_QUESTIONS = [
    "What is this page about in simple terms?",
    "Explain this page to me like I'm 5 years old.",
    "What are important details of this page?",
    "Draft an email to my boss.",
    "Who was the explorer Magellan?",
    "How does quantum computing work?",
  ];

  // Shuffle and pick 3 questions
  const shuffled = [...SUGGESTION_QUESTIONS].sort(() => Math.random() - 0.5);
  const selectedQuestions = shuffled.slice(0, 3);

  selectedQuestions.forEach((question) => {
    const suggestionButton = document.createElement("button");
    suggestionButton.className = "suggestion-question";
    suggestionButton.textContent = question;
    suggestionButton.addEventListener("click", () => {
      const searchQueryEl = document.getElementById("searchQuery");
      if (searchQueryEl) {
        searchQueryEl.value = question;
        handleSearch();
      }
    });
    questionsContainer.appendChild(suggestionButton);
  });

  suggestionsContainer.appendChild(questionsContainer);
  container.appendChild(suggestionsContainer);
}

/**
 * Updates the status message in the UI
 * @function
 * @param {string} message - Status message to display
 * @param {string} [type='idle'] - Status type ('idle', 'warning', 'error', 'success')
 * @description
 * Updates the status bar with appropriate styling based on the message type.
 * Used for user feedback about search state, errors, and success messages.
 */
export function updateStatus(message, type = "idle") {
  // Status indicator removed - errors are shown in chat messages
  // This function is kept for compatibility but does nothing
}

/**
 * Renders the citations section with navigation controls
 * @function
 * @param {Array<Citation>} citedSentences - List of cited sentences
 * @param {number} currentCitedSentenceIndex - Index of current citation
 * @param {Array<Object>} pageIdentifiedElements - Elements from the page
 * @description
 * Renders the citations panel with:
 * - List of cited sentences
 * - Active citation highlighting
 * - Click handlers for navigation
 * - Scroll management
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
 * @function
 * @param {Array<Citation>} citedSentences - List of cited sentences
 * @param {number} [currentIndex=-1] - Current citation index
 * @description
 * Updates the prev/next navigation buttons based on:
 * - Presence of citations
 * - Current citation index
 * - Navigation state
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
 * Navigates to a citation match on the page
 * @async
 * @function
 * @param {number} forTabId - ID of the tab to navigate in
 * @param {number} newIndexInPopupList - Index of the citation to navigate to
 * @param {boolean} [isInitialScroll=false] - Whether this is the initial scroll
 * @description
 * Handles citation navigation by:
 * 1. Validating the target citation
 * 2. Updating the UI state
 * 3. Scrolling to the element
 * 4. Managing highlight classes
 * 5. Handling navigation errors
 *
 * This function coordinates between the popup UI and the page content
 * to provide smooth citation navigation.
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

/**
 * Removes all highlights from the current page
 * @async
 * @function
 */
export async function handleRemoveHighlights() {
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
        // Status indicator will auto-hide after 2 seconds
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
export function handleNextMatch() {
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
export function handlePrevMatch() {
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
