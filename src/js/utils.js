/**
 * @fileoverview Utility functions for Magellan
 */

/**
 * Simple markdown parser that converts basic markdown to HTML
 * @param {string} markdown - The markdown text to parse
 * @returns {string} The parsed HTML
 */
export function parseMarkdown(markdown) {
  if (!markdown) return "";

  // Escape HTML special characters
  const escapeHtml = (text) => {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  };

  // Process code blocks first to prevent other markdown processing
  let html = markdown.replace(/```([\s\S]*?)```/g, (match, code) => {
    return `<pre><code>${escapeHtml(code.trim())}</code></pre>`;
  });

  // Process inline code
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Process headers
  html = html.replace(/^### (.*$)/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.*$)/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.*$)/gm, "<h1>$1</h1>");

  // Process bold and italic
  html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.*?)\*/g, "<em>$1</em>");

  // Process lists
  html = html.replace(/^\s*[-*+]\s+(.*$)/gm, "<li>$1</li>");
  html = html.replace(/(<li>.*<\/li>)/gs, "<ul>$1</ul>");

  // Process numbered lists
  html = html.replace(/^\s*\d+\.\s+(.*$)/gm, "<li>$1</li>");
  html = html.replace(/(<li>.*<\/li>)/gs, "<ol>$1</ol>");

  // Process blockquotes
  html = html.replace(/^\> (.*$)/gm, "<blockquote>$1</blockquote>");

  // Process links
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
  );

  // Process paragraphs
  html = html.replace(/^(?!<[h|ul|ol|blockquote|pre])(.*$)/gm, "<p>$1</p>");

  // Clean up empty paragraphs and fix nested lists
  html = html
    .replace(/<p><\/p>/g, "")
    .replace(/<\/p>\s*<p>/g, "\n")
    .replace(/<\/ul>\s*<ul>/g, "")
    .replace(/<\/ol>\s*<ol>/g, "");

  return html;
}
