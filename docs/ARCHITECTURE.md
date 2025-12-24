# Magellan Architecture

This document outlines the technical architecture of Magellan, with a focus on how we handle page data extraction, processing, and interaction.

## Overview

Magellan is built as a Chrome extension with a modular architecture organized into several key components:

### Core Components

1. **Background Service Worker** (`core/background.js`)

   - Manages extension lifecycle
   - Handles tab state initialization
   - Coordinates communication between components

2. **UI Layer** (`ui/`)

   - `sidebar.js` - Main sidebar interface and user interaction
   - `ui.js` - Reusable UI components and utilities
   - `model-selection.js` - AI model selection interface
   - `fileUpload.js` - Document upload, processing, and text extraction
   - `theme.js` - Theme management and system theme synchronization
   - `whats-new.js` - What's new page for user onboarding and updates

3. **Search System** (`search/`)

   - `search.js` - Core search implementation and AI query handling
   - `contentScript.js` - Page content extraction and interaction

4. **API Integration** (`api/`)

   - `api-key.js` - API key management and validation
   - `openrouter.js` - OpenRouter API integration and query handling

5. **State Management** (`state/`)

   - `tabState.js` - Tab-specific state management and persistence

6. **Core Utilities** (`core/`)

   - `utils.js` - Shared utility functions and helpers

### Component Interaction

```mermaid
graph TD
    A[UI Layer] -->|User Input| B[Search System]
    B -->|Query| C[OpenRouter API]
    B -->|Extract| D[Content Script]
    D -->|Store| E[State Management]
    E -->|Retrieve| B
    C -->|Response| B
    B -->|Update| A
    F[Background Service] -->|Initialize| E
    F -->|Monitor| D
    G[Theme System] -->|Apply Theme| A
    G -->|Listen| H[System Theme]
    I[What's New Page] -->|Onboarding| A
    I -->|Storage| J[User Preferences]
    K[File Upload System] -->|Process Documents| B
    K -->|Store Content| E
    L[Model Selection] -->|Model Choice| C
    M[Help Page] -->|Documentation| A
    N[Real-time Search] -->|Web Results| B
```

## Page Data Flow

```mermaid
graph TD
    A[Web Page] -->|Content Script| B[Extract & ID Elements]
    B -->|Store| C[Tab State]
    C -->|Process| D[AI Query]
    D -->|Generate| E[Response + Citations]
    E -->|Highlight| F[Page Elements]
```

## Page Content Extraction

### Element Selection

We use a targeted approach to extract meaningful content:

```javascript
const selectors =
  "p, h1, h2, h3, h4, h5, h6, li, span, blockquote, td, th, pre," +
  "div:not(:has(p, h1, h2, h3, h4, h5, h6, li, article, section, main, aside, nav, header, footer, form)), " +
  "article, section, main";
```

This selector strategy:

- Prioritizes semantic HTML elements
- Excludes container elements that don't add value
- Captures both block and inline elements
- Avoids duplicate content

### Element Processing

Each element goes through several checks:

1. **Visibility Check**

   - Filters out hidden elements
   - Checks computed styles (display, visibility, opacity)
   - Verifies element dimensions
   - Excludes off-screen elements

2. **Content Validation**

   - Minimum text length: 15 characters
   - Maximum text length: 2500 characters per node
   - Filters out duplicate content
   - Removes empty or whitespace-only elements

3. **Element Identification**
   - Assigns unique IDs (`mgl-node-{counter}`)
   - Stores element references
   - Maintains parent-child relationships
   - Preserves DOM structure

### Content Storage

Extracted content is stored in two formats:

1. **Identified Elements**

```typescript
type IdentifiedElement = {
  id: string; // Unique identifier (e.g., "mgl-node-0")
  text: string; // Extracted text content
  element: Element; // Reference to DOM element
};
```

2. **Full Text Format**

```
[mgl-node-0] First paragraph text
[mgl-node-1] Second paragraph text
...
```

## Document Processing

### File Upload System

Magellan includes a comprehensive document upload and processing system that allows users to analyze various document formats:

#### Supported Formats

- **PDF** (.pdf) - Advanced text extraction with layout preservation
- **TXT** (.txt) - Plain text files
- **DOC/DOCX** (.doc, .docx) - Microsoft Word documents
- **MD** (.md) - Markdown files
- **RTF** (.rtf) - Rich Text Format files

#### Upload Interface

The upload system provides a compact, integrated interface:

- **Upload Button**: Small "+" icon positioned before the search input
- **Visual Feedback**: Button changes color when a document is uploaded
- **Tooltip Information**: Shows file name and upload status
- **One-Click Removal**: Click the upload button again to remove the document

#### Document Processing Pipeline

```mermaid
graph TD
    A[File Selection] -->|Validate| B[File Validation]
    B -->|Extract| C[Text Extraction]
    C -->|Process| D[Content Processing]
    D -->|Store| E[State Management]
    E -->|Use| F[Search System]
```

#### Text Extraction Methods

1. **PDF Processing**

   - Uses PDF.js library for client-side PDF parsing
   - Extracts text from all pages with layout preservation
   - Handles complex PDF structures and formatting
   - Provides progress updates for large documents
   - Error handling for password-protected or corrupted files

2. **Text File Processing**

   - Direct text extraction from TXT, MD, and RTF files
   - Preserves formatting where applicable
   - Handles encoding issues gracefully

3. **Word Document Processing**
   - Extracts text from DOC and DOCX files
   - Preserves document structure
   - Handles formatting and metadata

#### Content Integration

Uploaded documents integrate seamlessly with the search system:

- **Context Replacement**: Uploaded document content replaces page content
- **Search Modes**: Works with all search modes (Page Context, Blended, General Knowledge)
- **Citation System**: Document content can be cited in responses
- **Conversation History**: Document context persists across conversations
- **Storage**: Document content is stored in tab state for session persistence

#### Error Handling

The upload system includes comprehensive error handling:

- **File Validation**: Checks file type, size, and format
- **Extraction Errors**: Handles corrupted or unsupported files
- **Size Limits**: Enforces reasonable file size limits (20MB for PDFs, varies by format)
- **User Feedback**: Clear error messages and recovery options
- **Format-Specific**: Special handling for password-protected PDFs, encoding issues, and corrupted files

#### PDF Page Detection

The system intelligently detects when users are viewing PDF pages in the browser:

- **URL Detection**: Identifies PDF pages by URL ending (.pdf)
- **Smart Guidance**: Prompts users to upload the document instead of using page context
- **Fallback Options**: Suggests switching to general knowledge mode
- **Better Results**: Ensures users get optimal text extraction through the upload system

## State Management

### Tab State

Each tab maintains its own state:

```typescript
type TabState = {
  /** Chat conversation history between user and AI assistant */
  chatHistory: Array<{
    /** Role of the message sender - either user or AI assistant */
    role: "user" | "assistant";
    /** The actual message content */
    content: string;
    /** Optional citations from the page for assistant messages */
    citations?: Array<CitedSentence>;
    /** True if the answer comes from general knowledge rather than page content */
    isExternalSource?: boolean;
    /** True if user clicked "Prompt with GK" button for this message */
    gkPrompted?: boolean;
  }>;
  /** Currently active citations from the page that are being highlighted */
  citedSentences: Array<CitedSentence>;
  /** Index of the currently viewed citation in citedSentences array */
  currentCitedSentenceIndex: number;
  /** Current state of the extension's processing pipeline */
  status: "idle" | "extracting" | "querying_llm" | "ready" | "error";
  /** Error message if status is 'error', empty otherwise */
  errorMessage: string;
  /** Full text content extracted from the page, formatted for AI processing */
  fullPageTextContent: string;
  /** List of identified elements from the page with their IDs and text content */
  pageIdentifiedElements: Array<IdentifiedElement>;
};
```

### State Lifecycle

1. **Initialization**

   - Created when tab is activated
   - Persists until tab is closed
   - Maintains chat history and citations

2. **Updates**
   - Modified during content extraction
   - Updated with AI responses
   - Tracks citation navigation
   - Manages error states

## AI Integration

### OpenRouter Integration

Magellan uses OpenRouter as its AI backend, providing access to hundreds of AI models:

- **Model Selection**: Users can choose from hundreds of available models
- **Free Models**: OpenRouter offers free models with rate limits
- **Paid Models**: Upgrade to paid models for higher rate limits
- **Flexible Switching**: Switch between models optimized for speed, accuracy, or specific capabilities
- **API Key Management**: Secure local storage of OpenRouter API keys

### Search Modes

Magellan supports three distinct search modes:

1. **Page Context Mode**

   - Searches only within the current page content
   - Requires relevant page content to be found
   - Provides citations from the page
   - Falls back to "no relevant content" message if nothing found

2. **General Knowledge Mode**

   - Uses only AI's general knowledge
   - Ignores page content completely
   - No citations provided
   - Always marked as external source

3. **Blended Mode**
   - First attempts to find relevant content on the page
   - Uses content relevance check to determine if page content is useful
   - If page content is relevant:
     - Provides answer with page citations
     - Marked as page context answer
   - If page content is not relevant:
     - Falls back to general knowledge
     - Marked as external source
     - No citations provided
   - Allows manual fallback to general knowledge via "Use General Knowledge" button

### Real-time Web Search

Magellan includes an optional real-time web search feature:

- **Toggle Control**: Users can enable/disable real-time search via a toggle button
- **Current Events**: Provides up-to-date information for time-sensitive queries
- **Integration**: Works seamlessly with all search modes
- **Use Cases**: Perfect for news, recent developments, or queries requiring current information

### Content Relevance Check

The blended mode uses a dedicated relevance check:

```javascript
async function isPageContentRelevant(query, pageContent) {
  const relevancePrompt = `
You are an AI assistant helping determine if a webpage's content is relevant to a user's question.
The user has asked: "${query}"

Here is the content from the webpage:
${pageContent}

Please determine if the webpage content is relevant to answering the user's question.
Respond with ONLY "RELEVANT" or "NOT_RELEVANT".
`;
  // ... implementation
}
```

### Query Processing

1. **Context Preparation**

   - Combines user query with page content
   - Formats element IDs and text
   - Maintains conversation history

2. **Prompt Structure**

```
You are an AI assistant helping a user understand the content of a webpage.
The user has asked: "{query}"

Here is the relevant text content extracted from the page. Each piece of text is preceded by its unique element ID in square brackets (e.g., [mgl-node-0]).

--- START OF PAGE CONTENT ---
{formattedContent}
--- END OF PAGE CONTENT ---

Please:
1. Provide a concise answer based *only* on the provided content
2. Identify up to {numCitations} element IDs that support your answer
```

### Response Handling

1. **Citation Extraction**

   - Parses AI response for element IDs
   - Validates IDs against stored elements
   - Creates citation objects
   - Handles both page context and general knowledge responses

2. **UI Updates**

   - Updates chat history with source indication (page context vs general knowledge)
   - Renders citations for page context answers
   - Manages highlights for page context answers
   - Updates navigation state
   - Shows appropriate status messages based on response source
   - Displays copy and citations buttons for assistant messages
   - Implements chunked typing animation for faster response display

3. **Response Types**
   - Page Context Response:
     - Blue header with "Answer from page context"
     - Includes citations and highlights
     - Shows "Use General Knowledge" button
     - Copy button for easy response copying
     - Citations button for viewing all sources
   - General Knowledge Response:
     - Green header with "Answer from general knowledge"
     - No citations or highlights
     - Copy button for easy response copying
     - No citations button (no sources available)

## Highlight Management

### Highlight Types

1. **Cited Element Highlight**

   - Class: `mgl-cited-element-highlight`
   - Style: Light background with rounded corners
   - Purpose: Shows all cited elements

2. **Active Element Highlight**
   - Class: `mgl-active-element-highlight`
   - Style: Outline with shadow
   - Purpose: Indicates currently viewed citation

### Highlight Operations

1. **Application**

   - Injects CSS styles
   - Adds highlight classes
   - Maintains element references
   - Handles visibility toggling

2. **Navigation**
   - Scrolls to active element
   - Updates highlight states
   - Manages focus
   - Handles edge cases

## UI Features

### Collapsible Input Section

The input section can be collapsed to maximize screen space:

- **Collapse Toggle**: Small caret button to hide/show input controls
- **Smooth Animation**: CSS transitions for collapse/expand
- **State Persistence**: Collapsed state saved in Chrome storage
- **Minimal View**: When collapsed, shows only the input field

### Action Buttons

The input section includes several action buttons:

- **Search Mode Button**: Toggles between Page, Blended, and General modes with visual icons
- **Model Selection Button**: Opens model selection interface
- **Real-time Search Toggle**: Enables/disables real-time web search
- **Document Upload Button**: Opens file picker for document upload
- **Submit Button**: Submits the query (subtle ">" icon)

All buttons include:

- Tooltips for clarity
- Purple hue when active/toggled
- Consistent styling and positioning

### Message Actions

Each assistant message includes action buttons:

- **Copy Button**: Copies the entire response to clipboard with visual feedback (checkmark)
- **Citations Button**: Opens citations tab and navigates to sources (only for messages with citations)
- **Positioning**: Buttons aligned to the right, always visible
- **Styling**: Matches input section button design

### Help Page

A dedicated help page (`help.html`) provides:

- Comprehensive feature documentation
- Detailed explanations of each button and mode
- Tips and best practices
- Accessible from settings menu

## Performance Considerations

1. **Content Extraction**

   - Processes elements in batches
   - Uses efficient selectors
   - Implements early filtering
   - Caches results

2. **Memory Management**

   - Cleans up old highlights
   - Removes unused element IDs
   - Manages tab state lifecycle
   - Handles page unload

3. **UI Responsiveness**
   - Asynchronous processing
   - Progressive loading
   - Efficient DOM operations
   - Chunked typing animation (3-5 characters) for faster perceived performance
   - Smooth CSS transitions for animations

## Security

1. **Content Isolation**

   - Sandboxed content scripts
   - Limited DOM access
   - Secure message passing
   - API key protection

2. **Data Handling**
   - Local storage only
   - No external data transmission
   - Secure API communication
   - Privacy-focused design

## Error Handling

1. **Extraction Errors**

   - Invalid selectors
   - DOM access issues
   - Content parsing failures
   - Memory constraints

2. **AI Integration Errors**

   - API failures
   - Invalid responses
   - Rate limiting (especially for free OpenRouter models)
   - Network issues
   - Model-specific errors
   - API key validation failures

3. **UI Errors**
   - Element not found
   - Navigation failures
   - State inconsistencies
   - Highlight issues

## Future Improvements

Please visit our [issues](https://github.com/magellan-extension/magellan/issues).

Contributions are welcome and greatly appreciated.

Feel free to suggest additional features as well.

Thanks!

## Component Details

### UI Layer (`ui/`)

The UI layer is responsible for all user interaction and presentation:

1. **Sidebar Component** (`sidebar.js`)

   - Manages the main extension interface
   - Handles user input and query submission
   - Displays chat history and responses
   - Controls search mode selection
   - Manages citation navigation
   - Implements collapsible input section
   - Handles model selection
   - Manages real-time search toggle
   - Provides tooltips for all action buttons
   - Handles help page navigation

2. **UI Utilities** (`ui.js`)

   - Provides reusable UI components
   - Handles DOM manipulation
   - Manages highlight rendering
   - Controls animation and transitions
   - Implements chunked typing animation (3-5 character chunks)
   - Handles copy-to-clipboard functionality
   - Manages citations button and navigation
   - Renders message action buttons (copy, citations)
   - Implements smooth tab switching animations

3. **What's New Component** (`whats-new.js`)

   - Manages the what's new page interface
   - Handles user onboarding flow
   - Controls navigation between pages
   - Manages storage for user interaction tracking

4. **Model Selection Component** (`model-selection.js`)

   - Manages AI model selection interface
   - Displays available models from OpenRouter
   - Handles model switching and persistence
   - Updates model selection button tooltip

5. **File Upload Component** (`fileUpload.js`)

   - Handles document upload interface
   - Manages file validation and processing
   - Provides visual feedback for upload status
   - Integrates with text extraction system

6. **Theme Component** (`theme.js`)
   - Centralized theme management across all extension pages
   - Handles system theme detection and synchronization
   - Manages theme persistence in Chrome storage
   - Provides automatic theme application and switching

### Search System (`search/`)

The search system coordinates content extraction and AI queries:

1. **Search Implementation** (`search.js`)

   - Implements search modes (Page Context, Blended, General Knowledge)
   - Manages query processing
   - Handles response parsing
   - Coordinates with API integration

2. **Content Script** (`contentScript.js`)
   - Extracts page content
   - Manages element identification
   - Handles highlight management
   - Communicates with the main extension

### API Integration (`api/`)

Handles all external API interactions:

1. **API Key Management** (`api-key.js`)

   - Manages API key storage
   - Handles key validation
   - Provides key retrieval

2. **OpenRouter Integration** (`openrouter.js`)
   - Implements OpenRouter API integration
   - Manages API requests to OpenRouter endpoints
   - Handles response processing and streaming
   - Implements retry logic and error handling
   - Supports multiple AI models
   - Manages model-specific configurations

### State Management (`state/`)

The state management system maintains the application state:

1. **Tab State** (`tabState.js`)
   - Manages per-tab state
   - Handles state persistence
   - Coordinates state updates
   - Maintains chat history
   - Tracks citation state

### Core Utilities (`core/`)

Provides essential functionality used across components:

1. **Background Service** (`background.js`)

   - Manages extension lifecycle
   - Initializes tab states
   - Coordinates component communication
   - Handles extension events

2. **Utilities** (`utils.js`)
   - Provides shared helper functions
   - Implements common algorithms
   - Handles data formatting
   - Manages error handling

## Theme System

### Overview

The theme system provides consistent theming across all extension pages (sidebar, API key page, what's new page) with support for:

- Light and dark themes
- System theme synchronization
- Theme persistence
- Automatic theme application

### Theme Storage

Themes are stored in Chrome's local storage:

```typescript
type ThemePreference = "light" | "dark" | "system";
```

### Theme Implementation

1. **Theme Module** (`theme.js`)

   - Centralized theme management
   - System theme detection
   - Theme persistence
   - Automatic theme application

2. **Theme Application**

   - Uses CSS variables for theme colors
   - Applies theme via `data-theme` attribute
   - Supports dynamic theme switching
   - Handles system theme changes

3. **Theme Variables**

   ```css
   :root[data-theme="light"] {
     --bg-primary: #ffffff;
     --bg-secondary: #f3f4f6;
     --text-primary: #1f2937;
     --text-secondary: #4b5563;
     /* ... other light theme variables ... */
   }

   :root[data-theme="dark"] {
     --bg-primary: #1f2937;
     --bg-secondary: #111827;
     --text-primary: #f9fafb;
     --text-secondary: #d1d5db;
     /* ... other dark theme variables ... */
   }
   ```

4. **Theme Features**
   - Automatic theme detection on page load
   - System theme synchronization
   - Theme persistence across sessions
   - Smooth theme transitions
   - Consistent styling across all pages
