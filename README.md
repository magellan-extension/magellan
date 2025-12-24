# Magellan - Your AI Superpower

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![Get it on Chrome Web Store](https://img.shields.io/badge/Chrome_Web_Store-Get_it_here-4285F4?logo=google-chrome&logoColor=white)](https://chromewebstore.google.com/detail/magellan/ekkajebdacenikgmbgkdnmememnlibnd)

Magellan is an open-source Chrome extension that transforms your browser into an intelligent AI research assistant. It's your all-purpose AI tool that works seamlessly within your browser, allowing you to ask questions about any webpage or document and get instant, cited answers. Whether you're reading an article, analyzing a document, or researching a topic, Magellan understands the context and provides accurate, verifiable information.

[Demo](https://www.youtube.com/watch?v=xeA9RsXxIdM)

![Magellan Screenshot](public/screenshot.png)

## Features

- 🧠 **AI-Powered Search** – Ask questions about any webpage and get instant answers
  - **Three Intelligent Search Modes**:
    - **Page Context**: Search exclusively within the current page or document
    - **Blended**: Combines page content with general knowledge for comprehensive answers
    - **General Knowledge**: Use AI knowledge independent of page content
- 📄 **Document Analysis** – Upload and analyze multiple file formats
  - **Supported Formats**: PDF, TXT, DOC, DOCX, MD, RTF
  - **Smart Context**: Uses uploaded documents as page context for searches
- 📚 **Smart Citations & Visual Highlights** – See exactly where information comes from
  - Automatic citation extraction with visual highlights on the page
  - Navigate between citations effortlessly
  - Click any citation to jump directly to the relevant section
- 🔍 **Real-time Web Search** – Enable optional real-time web search for current events and up-to-date information
- 🤖 **Flexible AI Model Selection** – Choose from hundreds of AI models via OpenRouter
  - Free models available with rate limits
  - Upgrade to paid models for higher limits
  - Switch between models optimized for speed, accuracy, or specific capabilities
- 💬 **Persistent Chat History** – Your conversation history is saved per browser tab
  - Different conversations on different pages
  - History persists across sessions
- 📋 **Copy Responses** – One-click copy button for each AI response
- 🎨 **Beautiful, Customizable Interface**
  - Light and dark themes with system theme sync
  - Collapsible interface for maximum screen space
  - Clean, modern design that integrates seamlessly with your workflow
- 📖 **Help & Documentation** – Built-in help page detailing all features
- 💸 **100% Free & Open Source** – No subscriptions, no paywalls, no data harvesting

## 🚀 Quick Start

1. Install the extension:

   - [Get it from the Chrome Web Store](https://chromewebstore.google.com/detail/magellan/ekkajebdacenikgmbgkdnmememnlibnd)
   - Or download the latest release:
     1. Go to the [Releases page](https://github.com/magellan-extension/magellan/releases)
     2. Download the zip file from the latest release
     3. Extract the zip file
     4. Open Chrome and go to `chrome://extensions/`
     5. Enable "Developer mode" in the top right
     6. Click "Load unpacked" and select the extracted folder
   - Or [build from source](#🛠️-development)

2. Get your OpenRouter API key:

   - Visit [OpenRouter](https://openrouter.ai/)
   - Sign up for a free account
   - Create a new API key
   - Copy the key
   - **Note**: OpenRouter offers free models with rate limits, or you can use paid models for higher limits

3. Start using Magellan:
   - Click the Magellan icon in your Chrome toolbar to open the sidebar
   - **Choose your preferred search mode**:
     - **Page Context**: Best for understanding specific content on the page
     - **Blended**: Good for general questions that might need additional context
     - **General Knowledge**: Use when you want answers not limited to the page content
   - **Select your AI model**: Click the model selector to choose from hundreds of available models
   - **Upload Documents**: Click the upload button (+) to add PDF, TXT, DOC, DOCX, MD, or RTF files for analysis
   - **Enable Real-time Search** (optional): Toggle real-time web search for current events and up-to-date information
   - Type your question about the current page or uploaded document
   - Get AI-powered answers with highlighted citations
   - **Copy responses**: Click the copy button to copy any AI response to your clipboard
   - **View citations**: Click the citations button to see all sources and navigate between them

💡 **Pro Tip**: For quick access, set up a keyboard shortcut in Chrome's extension settings:

1. Go to `chrome://extensions/shortcuts`
2. Find Magellan in the list
3. Set your preferred keyboard shortcut for "Activate the extension"

## 🛠️ Development

### Building from Source

1. Clone the repository:

   ```bash
   git clone https://github.com/magellan-extension/magellan.git
   ```

2. Load the extension in Chrome:

   - Open Chrome and go to `chrome://extensions/`
   - Enable "Developer mode" in the top right
   - Click "Load unpacked" and select the `magellan` repository

3. Make your changes to the source code
4. Test the extension locally using Chrome's developer mode
5. Submit a pull request with your changes

### Project Structure

```
magellan/
├── src/                    # Source code
│   ├── js/                # JavaScript files
│   │   ├── api/          # API integration
│   │   │   ├── api-key.js    # API key management
│   │   │   └── openrouter.js # OpenRouter API integration
│   │   ├── core/         # Core functionality
│   │   │   ├── background.js # Background service worker
│   │   │   └── utils.js      # Utility functions
│   │   ├── search/       # Search functionality
│   │   │   ├── search.js     # Search implementation
│   │   │   └── contentScript.js # Content script for page interaction
│   │   ├── state/        # State management
│   │   │   └── tabState.js   # Tab state management
│   │   └── ui/           # User interface
│   │       ├── sidebar.js    # Sidebar component
│   │       ├── model-selection.js # Model selection UI
│   │       ├── fileUpload.js # File upload handling
│   │       ├── theme.js      # Theme management
│   │       ├── whats-new.js  # Displays extension updates
│   │       └── ui.js         # UI utilities and components
│   └── html/              # HTML files
│       ├── sidebar.html     # Main sidebar UI
│       ├── api-key.html     # API key setup page
│       ├── model-selection.html # Model selection page
│       ├── help.html        # Help and features page
│       └── whats-new.html  # What's new page
├── public/                # Static assets
├── docs/                  # Documentation
└── manifest.json          # Chrome extension manifest
```

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details on:

- How to submit issues and feature requests
- Our development process
- Pull request guidelines

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🌐 Links

- [Chrome Extension](https://chromewebstore.google.com/detail/magellan/ekkajebdacenikgmbgkdnmememnlibnd)
- [Website](https://kpulgari.com/magellan/)
- [Issue Tracker](https://github.com/magellan-extension/magellan/issues)
- [Documentation](docs/)

---

Star us on GitHub if you find this project helpful! Thanks!
