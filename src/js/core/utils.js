/**
 * @fileoverview Utility functions for Magellan
 */

/**
 * Simple markdown parser that converts basic markdown to HTML
 * Supports headers, bold/italic, code, blockquotes, links, and real list grouping.
 * @param {string} markdown - The markdown text to parse
 * @returns {string} The parsed HTML
 */
export function parseMarkdown(markdown) {
  if (!markdown || typeof markdown !== "string") return "";

  // Escape HTML special characters
  const escapeHtml = (text) =>
    text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");

  // Store code blocks and replace with placeholders
  const codeBlocks = [];
  markdown = markdown.replace(/```([\s\S]*?)```/g, (_, code) => {
    const escaped = `<pre><code>${escapeHtml(code.trim())}</code></pre>`;
    codeBlocks.push(escaped);
    return `__CODEBLOCK_${codeBlocks.length - 1}__`;
  });

  // Inline code
  markdown = markdown.replace(
    /`([^`\n]+)`/g,
    (_, code) => `<code>${escapeHtml(code)}</code>`
  );

  // Headers
  markdown = markdown
    .replace(/^### (.*)$/gm, "<h3>$1</h3>")
    .replace(/^## (.*)$/gm, "<h2>$1</h2>")
    .replace(/^# (.*)$/gm, "<h1>$1</h1>");

  // Bold and italic
  markdown = markdown
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>");

  // Blockquotes
  markdown = markdown.replace(/^> (.*)$/gm, "<blockquote>$1</blockquote>");

  // Links
  markdown = markdown.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
  );

  // Convert lines into array for list processing
  const lines = markdown.split("\n");
  let result = [];
  let listBuffer = [];
  let currentListType = null;

  for (let line of lines) {
    const trimmed = line.trim();

    const bulletMatch = /^[-*+] (.+)/.exec(trimmed);
    const numberedMatch = /^\d+\. (.+)/.exec(trimmed);

    if (bulletMatch) {
      const item = bulletMatch[1];
      if (currentListType !== "ul") {
        flushList(); // close previous list if any
        currentListType = "ul";
      }
      listBuffer.push(`<li>${item}</li>`);
    } else if (numberedMatch) {
      const item = numberedMatch[1];
      if (currentListType !== "ol") {
        flushList();
        currentListType = "ol";
      }
      listBuffer.push(`<li>${item}</li>`);
    } else {
      flushList();
      result.push(line);
    }
  }

  flushList();

  function flushList() {
    if (listBuffer.length) {
      result.push(
        `<${currentListType}>${listBuffer.join("")}</${currentListType}>`
      );
      listBuffer = [];
    }
    currentListType = null;
  }

  markdown = result.join("\n");

  // Paragraphs (skip lines that are already block elements)
  markdown = markdown.replace(
    /^(?!<(h\d|ul|ol|li|blockquote|pre|code|a|\/)).+$/gm,
    (line) => {
      if (line.trim() === "") return "";
      return `<p>${line}</p>`;
    }
  );

  // Restore code blocks
  markdown = markdown.replace(/__CODEBLOCK_(\d+)__/g, (_, i) => codeBlocks[i]);

  return markdown;
}
