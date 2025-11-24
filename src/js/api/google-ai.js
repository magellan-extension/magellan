/**
 * @fileoverview Google AI SDK for Chrome Extension
 * @description A simplified version of the Google AI SDK that works in Chrome extensions.
 * This module provides a wrapper around the Google Gemini API for generating AI responses.
 * It handles API communication, error handling, and response formatting.
 *
 * @requires fetch API
 * @see {@link https://ai.google.dev/docs/gemini_api_overview|Gemini API Documentation}
 *
 * @example
 * const genAI = new GoogleGenAI({ apiKey: 'your-api-key' });
 * const response = await genAI.generateContent('What is the capital of France?');
 * console.log(response.text); // "The capital of France is Paris."
 */

/**
 * Configuration object for GoogleGenAI
 * @typedef {Object} GoogleGenAIConfig
 * @property {string} apiKey - The Google AI API key
 */

/**
 * Response object from generateContent
 * @typedef {Object} GenerateContentResponse
 * @property {string} text - The generated text response
 */

/**
 * Class representing the Google AI client for Chrome extensions
 * @class
 */
class GoogleGenAI {
  /**
   * Create a new Google AI client
   * @param {GoogleGenAIConfig} config - Configuration object containing API key
   * @throws {Error} If API key is not provided
   */
  constructor(config) {
    if (!config.apiKey) {
      throw new Error("API key is required");
    }
    this.apiKey = config.apiKey;
    this.baseUrl = "https://generativelanguage.googleapis.com/v1beta/models";
  }

  /**
   * Generate content using the Gemini API
   * @param {string} prompt - The input prompt for the AI model
   * @returns {Promise<GenerateContentResponse>} A promise that resolves to the generated response
   * @throws {Error} If the API request fails or returns an error
   *
   * @example
   * try {
   *   const response = await genAI.generateContent('Explain quantum computing');
   *   console.log(response.text);
   * } catch (error) {
   *   console.error('Error:', error.message);
   * }
   */
  async generateContent(prompt) {
    const model = "gemini-2.5-flash-lite";
    const url = `${this.baseUrl}/${model}:generateContent?key=${this.apiKey}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: prompt,
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      if (response.status === 503) {
        throw new Error("Gemini connection failed. Please try again shortly.");
      } else if (response.status === 400) {
        throw new Error("Invalid API key.");
      }
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return {
      text: data.candidates[0].content.parts[0].text,
    };
  }
}

window.GoogleGenAI = GoogleGenAI;
