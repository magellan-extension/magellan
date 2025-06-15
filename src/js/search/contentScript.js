/**
 * @fileoverview Content script utilities for the Magellan extension
 *
 * This module contains functions that are injected into and executed within the context of web pages.
 * These functions handle the extraction, identification, and highlighting of relevant content elements
 * on the page. They are designed to be executed via chrome.scripting.executeScript() from the extension's
 * background or popup scripts.
 *
 * Key responsibilities:
 * 1. Extracting and identifying relevant text content from the page
 * 2. Managing element highlighting for cited content
 * 3. Cleaning up highlights and element IDs when needed
 *
 * @module contentScript
 */

/**
 * Extracts and identifies relevant elements from the page content.
 * This function is injected into the page context and analyzes the DOM to find
 * meaningful text content that can be used for search and citation.
 *
 * The function:
 * 1. Identifies visible, meaningful text elements using a comprehensive selector list
 * 2. Filters out hidden, script, and non-content elements
 * 3. Assigns unique IDs to elements for later reference
 * 4. Handles nested content appropriately to avoid duplication
 * 5. Respects element visibility and content hierarchy
 *
 * @function contentScript_extractAndIdRelevantElements
 * @returns {Object} Object containing:
 *   @property {Array<{id: string, text: string}>} identifiedElements - Array of identified elements with their IDs and text content
 *   @property {string} fullTextForLLM - Formatted text content ready for LLM processing
 *
 * @example
 * // In the extension context:
 * const results = await chrome.scripting.executeScript({
 *   target: { tabId: currentTabId },
 *   func: contentScript_extractAndIdRelevantElements
 * });
 * const { identifiedElements, fullTextForLLM } = results[0].result;
 */

/**
 * Clears all highlights and element IDs from the page.
 * This function removes all Magellan-specific classes and data attributes
 * that were added during the highlighting process.
 *
 * The function:
 * 1. Removes highlight classes from all elements
 * 2. Removes Magellan element IDs
 * 3. Returns a summary of cleared elements
 *
 * @function contentScript_clearHighlightsAndIds
 * @returns {Object} Summary of cleared elements:
 *   @property {number} clearedIds - Number of element IDs removed
 *   @property {number} clearedHighlights - Number of highlight classes removed
 *
 * @example
 * // In the extension context:
 * await chrome.scripting.executeScript({
 *   target: { tabId: currentTabId },
 *   func: contentScript_clearHighlightsAndIds
 * });
 */

/**
 * Highlights elements on the page by their Magellan IDs.
 * This function adds highlight classes to elements that have been cited
 * in the LLM's response.
 *
 * The function:
 * 1. Clears existing highlights
 * 2. Adds highlight classes to elements with matching IDs
 * 3. Tracks the number of successfully highlighted elements
 *
 * @function contentScript_highlightElementsById
 * @param {Array<string>} elementIdsToHighlight - Array of element IDs to highlight
 * @returns {Object} Summary of highlighting results:
 *   @property {number} highlightCount - Number of elements successfully highlighted
 *
 * @example
 * // In the extension context:
 * const elementIds = ['mgl-node-1', 'mgl-node-2'];
 * await chrome.scripting.executeScript({
 *   target: { tabId: currentTabId },
 *   func: contentScript_highlightElementsById,
 *   args: [elementIds]
 * });
 */

// --- CONTENT SCRIPT FUNCTIONS ---
export function contentScript_extractAndIdRelevantElements() {
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

export function contentScript_clearHighlightsAndIds() {
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

export function contentScript_highlightElementsById(elementIdsToHighlight) {
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
