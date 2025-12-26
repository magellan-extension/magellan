/**
 * @fileoverview OpenRouter API Client for Chrome Extension
 * @description A client for interacting with OpenRouter API that supports multiple AI models.
 * This module provides a wrapper around the OpenRouter API for generating AI responses.
 * It handles API communication, error handling, and response formatting.
 *
 * @requires fetch API
 * @see {@link https://openrouter.ai/docs|OpenRouter API Documentation}
 *
 * @example
 * const openRouter = new OpenRouterClient({ apiKey: 'your-api-key', model: 'google/gemini-2.0-flash-exp' });
 * const response = await openRouter.generateContent('What is the capital of France?');
 * console.log(response.text); // "The capital of France is Paris."
 */

/**
 * Configuration object for OpenRouterClient
 * @typedef {Object} OpenRouterConfig
 * @property {string} apiKey - The OpenRouter API key
 * @property {string} model - The model identifier (e.g., 'google/gemini-2.0-flash-exp', 'xai/grok-beta')
 */

/**
 * Response object from generateContent
 * @typedef {Object} GenerateContentResponse
 * @property {string} text - The generated text response
 */

/**
 * Class representing the OpenRouter client for Chrome extensions
 * @class
 */
class OpenRouterClient {
  /**
   * Create a new OpenRouter client
   * @param {OpenRouterConfig} config - Configuration object containing API key and model
   * @throws {Error} If API key is not provided
   */
  constructor(config) {
    if (!config.apiKey) {
      throw new Error("API key is required");
    }
    if (!config.model) {
      throw new Error("Model is required");
    }
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.baseUrl = "https://openrouter.ai/api/v1/chat/completions";
  }

  /**
   * Generate content using the OpenRouter API
   * @param {string} prompt - The input prompt for the AI model
   * @returns {Promise<GenerateContentResponse>} A promise that resolves to the generated response
   * @throws {Error} If the API request fails or returns an error
   *
   * @example
   * try {
   *   const response = await openRouter.generateContent('Explain quantum computing');
   *   console.log(response.text);
   * } catch (error) {
   *   console.error('Error:', error.message);
   * }
   */
  async generateContent(prompt) {
    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        "HTTP-Referer": chrome.runtime.getURL(""),
        "X-Title": "Magellan Extension",
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      if (response.status === 401) {
        throw new Error("Invalid API key.");
      } else if (response.status === 402) {
        throw new Error(
          "Insufficient credits. Please add credits to your OpenRouter account or switch to a free model without real-time search."
        );
      } else if (response.status === 429) {
        throw new Error(
          "Rate limit exceeded. Please try again shortly or switch to a different model."
        );
      } else if (response.status === 503) {
        throw new Error("Service unavailable. Please try again shortly.");
      } else if (response.status === 400) {
        const errorMessage = errorData.error?.message || "Invalid request.";
        throw new Error(errorMessage);
      }
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    // Extract text from response
    // OpenRouter returns OpenAI-compatible format
    if (data.choices && data.choices.length > 0) {
      const content = data.choices[0].message?.content;
      if (content) {
        return {
          text: content,
        };
      }
    }

    throw new Error("Invalid response format from API");
  }

  /**
   * Update the model for this client instance
   * @param {string} model - The new model identifier
   */
  setModel(model) {
    this.model = model;
  }
}

window.OpenRouterClient = OpenRouterClient;
