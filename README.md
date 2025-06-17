# Magellan - Query Any Webpage with AI

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![Get it on Chrome Web Store](https://img.shields.io/badge/Chrome_Web_Store-Get_it_here-4285F4?logo=google-chrome&logoColor=white)](https://chromewebstore.google.com/detail/magellan/ekkajebdacenikgmbgkdnmememnlibnd)

Magellan is an open-source Chrome extension that brings conversational AI to your web browsing experience. It allows you to ask questions about the web page you're currently viewing and get AI-powered answers with smart citations. It can search through the page content and provide relevant citations, or use general knowledge when needed.

[Demo](https://www.youtube.com/watch?v=FGqaT5tMBI0)

![Magellan Screenshot](public/screenshot.png)

## Features

- 🧠 **AI-Powered Search** – Ask questions about any webpage and get instant answers
  - **Multiple Search Modes**:
    - **Page Context**: Search only within the current page content
    - **Blended**: Search page first, then use general knowledge if needed
    - **General Knowledge**: Use only general knowledge, ignore page content
- 📚 **Smart Citations** – Get direct links to the relevant parts of the page
- 🎯 **Visual Highlights** – See exactly where the information comes from with highlighted text
- 💬 **Conversation History** – Keep track of your questions and answers
- 🎨 **Theme Support** – Choose between light and dark themes, or sync with your system
- 🧼 **Sleek, Responsive UI** – Clean design that fits right into your browser workflow
- 💸 **100% Free** – No subscriptions, no paywalls, no data harvesting

## 🚀 Quick Start

1. Install the extension:

   - [Get it from the Chrome Web Store](https://chromewebstore.google.com/detail/magellan/ekkajebdacenikgmbgkdnmememnlibnd)
   - Or download the latest release:
     1. Go to the [Releases page](https://github.com/magellan-extension/magellan/releases)
     2. Download `package.zip` from the latest release
     3. Extract the zip file
     4. Open Chrome and go to `chrome://extensions/`
     5. Enable "Developer mode" in the top right
     6. Click "Load unpacked" and select the extracted folder
   - Or [build from source](#🛠️-development)

2. Get your API key:

   - Visit [Google AI Studio](https://makersuite.google.com/app/apikey)
   - Create a new API key
   - Copy the key

3. Start using Magellan:
   - Click the Magellan icon in your Chrome toolbar to open the sidebar
   - Choose your preferred search mode:
     - **Page Context**: Best for understanding specific content on the page
     - **Blended**: Good for general questions that might need additional context
     - **General Knowledge**: Use when you want answers not limited to the page content
   - Type your question about the current page
   - Get AI-powered answers with highlighted citations

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
│   │   │   └── google-ai.js  # Google AI SDK integration
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
│   │       ├── theme.js      # Theme management
│   │       ├── whats-new.js  # Displays extension updates
│   │       └── ui.js         # UI utilities and components
│   └── html/              # HTML files
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
