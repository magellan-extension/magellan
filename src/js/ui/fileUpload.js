/**
 * @module fileUpload
 * @description Handles file upload functionality for the Magellan extension.
 * This module manages:
 * - Drag and drop file uploads
 * - File validation and processing
 * - Text extraction from various file formats
 * - Integration with the search system
 *
 * Supported file types:
 * - PDF files (.pdf)
 * - Word documents (.doc, .docx)
 * - Text files (.txt)
 * - Markdown files (.md)
 * - Rich text files (.rtf)
 *
 * @requires chrome.storage API for file persistence
 */

/** @constant {number} Maximum file size in bytes (10MB) */
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/** @constant {Array<string>} Supported file types */
const SUPPORTED_FILE_TYPES = [
  "text/plain",
  "text/markdown",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/rtf",
];

/** @constant {Array<string>} Supported file extensions */
const SUPPORTED_EXTENSIONS = [".txt", ".md", ".pdf", ".doc", ".docx", ".rtf"];

/**
 * @typedef {Object} UploadedFile
 * @property {string} name - File name
 * @property {number} size - File size in bytes
 * @property {string} type - MIME type
 * @property {string} content - Extracted text content
 * @property {Date} uploadedAt - Upload timestamp
 */

/**
 * Current uploaded file state
 * @type {UploadedFile|null}
 */
let currentFile = null;

/**
 * Initializes the file upload functionality
 * @function
 * @description Sets up event listeners for file upload, drag and drop, and file processing
 */
export function initializeFileUpload() {
  const fileInput = document.getElementById("fileInput");
  const uploadButton = document.getElementById("uploadButton");
  const removeDocumentButton = document.getElementById("removeDocumentButton");
  const errorToastClose = document.getElementById("errorToastClose");

  if (!fileInput || !uploadButton) {
    console.error("File upload elements not found");
    return;
  }

  // File input change handler
  fileInput.addEventListener("change", handleFileSelect);

  // Upload button click handler - remove file if exists, otherwise upload
  uploadButton.addEventListener("click", () => {
    if (currentFile) {
      removeCurrentFile();
    } else {
      fileInput.click();
    }
  });

  // Remove document button click handler
  if (removeDocumentButton) {
    removeDocumentButton.addEventListener("click", removeCurrentFile);
  }

  // Error toast close button handler
  if (errorToastClose) {
    errorToastClose.addEventListener("click", hideErrorToast);
  }

  // Load existing file from storage
  loadFileFromStorage();
}

/**
 * Handles file selection from file input
 * @function
 * @param {Event} event - File input change event
 */
async function handleFileSelect(event) {
  const file = event.target.files[0];
  if (file) {
    await processFile(file);
  }
}

/**
 * Processes an uploaded file
 * @async
 * @function
 * @param {File} file - The file to process
 */
async function processFile(file) {
  try {
    // Validate file
    if (!validateFile(file)) {
      return;
    }

    // Show loading state
    showFileUploadLoading();

    // Extract text content
    const content = await extractTextFromFile(file);

    // Create file object
    currentFile = {
      name: file.name,
      size: file.size,
      type: file.type,
      content: content,
      uploadedAt: new Date(),
    };

    // Save to storage
    await saveFileToStorage(currentFile);

    // Update UI
    updateFileUploadUI(currentFile);

    // Update search placeholder
    updateSearchPlaceholder();

    console.log("File processed successfully:", currentFile.name);
  } catch (error) {
    console.error("Error processing file:", error);
    showFileUploadError("Failed to process file. Please try again.");
  }
}

/**
 * Validates a file for upload
 * @function
 * @param {File} file - The file to validate
 * @returns {boolean} Whether the file is valid
 */
function validateFile(file) {
  const extension = "." + file.name.split(".").pop().toLowerCase();
  const isPDF = extension === ".pdf";
  const maxSize = isPDF ? MAX_FILE_SIZE * 2 : MAX_FILE_SIZE;
  const fileSizeText = formatFileSize(file.size);
  const maxSizeText = formatFileSize(maxSize);

  if (file.size > maxSize) {
    if (isPDF) {
      showFileUploadError(
        `PDF file too large (${fileSizeText}). Maximum size for PDFs is ${maxSizeText}. Please try a smaller PDF.`
      );
    } else {
      showFileUploadError(
        `File too large (${fileSizeText}). Maximum size is ${maxSizeText}. Please try a smaller file.`
      );
    }
    return false;
  }

  // Check file type
  if (!SUPPORTED_EXTENSIONS.includes(extension)) {
    showFileUploadError(
      "Unsupported file type. Please upload a PDF, DOC, DOCX, TXT, MD, or RTF file."
    );
    return false;
  }

  return true;
}

/**
 * Extracts text content from a file
 * @async
 * @function
 * @param {File} file - The file to extract text from
 * @returns {Promise<string>} The extracted text content
 */
async function extractTextFromFile(file) {
  const extension = "." + file.name.split(".").pop().toLowerCase();

  switch (extension) {
    case ".txt":
    case ".md":
      return await extractTextFromTextFile(file);
    case ".pdf":
      return await extractTextFromPDF(file);
    case ".doc":
    case ".docx":
      return await extractTextFromWordDocument(file);
    case ".rtf":
      return await extractTextFromRTF(file);
    default:
      throw new Error("Unsupported file type");
  }
}

/**
 * Extracts text from a text file
 * @async
 * @function
 * @param {File} file - The text file
 * @returns {Promise<string>} The file content
 */
async function extractTextFromTextFile(file) {
  return await file.text();
}

/**
 * Extracts text from a PDF file
 * @async
 * @function
 * @param {File} file - The PDF file
 * @returns {Promise<string>} The extracted text
 */
async function extractTextFromPDF(file) {
  try {
    // Read the file as ArrayBuffer
    const arrayBuffer = await file.arrayBuffer();

    // Load the PDF document
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;

    let fullText = "";
    const totalPages = pdf.numPages;

    // Extract text from each page with progress updates
    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      // Update progress for large PDFs
      if (totalPages > 5) {
        updatePDFProgress(pageNum, totalPages);
      }

      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();

      // Process text items to preserve layout
      const pageText = processTextItems(textContent.items);

      fullText += pageText + "\n\n";
    }

    // Clear progress indicator
    clearPDFProgress();

    return fullText.trim();
  } catch (error) {
    console.error("Error extracting text from PDF:", error);

    // Clear progress indicator on error
    clearPDFProgress();

    // Provide more specific error messages
    if (error.name === "PasswordException") {
      throw new Error(
        "PDF is password-protected. Please remove the password and try again."
      );
    } else if (error.name === "InvalidPDFException") {
      throw new Error(
        "Invalid or corrupted PDF file. Please check the file and try again."
      );
    } else {
      throw new Error(
        "Failed to extract text from PDF. Please ensure the file is not corrupted or password-protected."
      );
    }
  }
}

/**
 * Updates the PDF processing progress indicator
 * @function
 * @param {number} currentPage - Current page being processed
 * @param {number} totalPages - Total number of pages
 */
function updatePDFProgress(currentPage, totalPages) {
  const placeholder = document.getElementById("fileUploadPlaceholder");
  if (placeholder) {
    const percentage = Math.round((currentPage / totalPages) * 100);
    placeholder.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; gap: 12px;">
        <div class="file-upload-spinner"></div>
        <div style="font-size: 13px; color: var(--text-primary);">Processing PDF...</div>
        <div style="font-size: 11px; color: var(--text-secondary);">Page ${currentPage} of ${totalPages} (${percentage}%)</div>
      </div>
    `;
  }
}

/**
 * Clears the PDF processing progress indicator
 * @function
 */
function clearPDFProgress() {
  const placeholder = document.getElementById("fileUploadPlaceholder");
  if (placeholder) {
    placeholder.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; gap: 12px;">
        <div class="file-upload-spinner"></div>
        <div style="font-size: 13px; color: var(--text-primary);">Processing file...</div>
      </div>
    `;
  }
}

/**
 * Processes text items from a PDF page to preserve layout
 * @function
 * @param {Array} items - Text items from the page
 * @returns {string} Processed text with preserved layout
 */
function processTextItems(items) {
  if (!items || items.length === 0) return "";

  let result = "";
  let lastY = null;
  let lastX = null;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const text = item.str;

    // Skip empty text
    if (!text || text.trim() === "") continue;

    // Check if we need a line break (significant Y position change)
    if (lastY !== null && Math.abs(item.transform[5] - lastY) > 5) {
      result += "\n";
    }
    // Check if we need a space (significant X position change)
    else if (lastX !== null && item.transform[4] - lastX > 10) {
      result += " ";
    }

    result += text;

    // Update last positions
    lastY = item.transform[5];
    lastX = item.transform[4] + item.width;
  }

  return result;
}

/**
 * Extracts text from a Word document
 * @async
 * @function
 * @param {File} file - The Word document
 * @returns {Promise<string>} The extracted text
 */
async function extractTextFromWordDocument(file) {
  // For now, return a placeholder. Word document extraction would require additional libraries
  // In a real implementation, you might use mammoth.js or similar
  throw new Error(
    "Word document text extraction not yet implemented. Please convert to text format."
  );
}

/**
 * Extracts text from an RTF file
 * @async
 * @function
 * @param {File} file - The RTF file
 * @returns {Promise<string>} The extracted text
 */
async function extractTextFromRTF(file) {
  // For now, return a placeholder. RTF extraction would require additional libraries
  throw new Error(
    "RTF text extraction not yet implemented. Please convert to text format."
  );
}

/**
 * Shows loading state for file upload
 * @function
 */
function showFileUploadLoading() {
  const uploadButton = document.getElementById("uploadButton");

  if (uploadButton) {
    // Show loading spinner on upload button
    uploadButton.innerHTML = `
      <div class="spinner" style="width: 12px; height: 12px; border-width: 1px;"></div>
    `;
    uploadButton.disabled = true;
    uploadButton.title = "Processing file...";
  }
}

/**
 * Shows error message for file upload
 * @function
 * @param {string} message - Error message to display
 */
function showFileUploadError(message) {
  const uploadButton = document.getElementById("uploadButton");
  const documentStatusBar = document.getElementById("documentStatusBar");
  const errorToast = document.getElementById("errorToast");
  const errorToastMessage = document.getElementById("errorToastMessage");

  if (uploadButton) {
    // Reset upload button
    uploadButton.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `;
    uploadButton.disabled = false;
    uploadButton.title = "Upload document";
    uploadButton.classList.remove("has-file");

    // Show error toast or notification
    console.error("File upload error:", message);
  }

  // Hide document status bar on error
  if (documentStatusBar) {
    documentStatusBar.style.display = "none";
  }

  // Show error toast
  if (errorToast && errorToastMessage) {
    errorToastMessage.textContent = message;
    errorToast.style.display = "flex";

    // Trigger animation
    setTimeout(() => {
      errorToast.classList.add("show");
    }, 10);

    // Auto-hide after 5 seconds
    setTimeout(() => {
      hideErrorToast();
    }, 5000);
  }
}

/**
 * Hides the error toast
 * @function
 */
function hideErrorToast() {
  const errorToast = document.getElementById("errorToast");
  if (errorToast) {
    errorToast.classList.remove("show");
    setTimeout(() => {
      errorToast.style.display = "none";
    }, 300);
  }
}

/**
 * Updates the file upload UI with file information
 * @function
 * @param {UploadedFile} file - The uploaded file
 */
function updateFileUploadUI(file) {
  const uploadButton = document.getElementById("uploadButton");
  const documentStatusBar = document.getElementById("documentStatusBar");
  const documentName = document.getElementById("documentName");

  if (uploadButton) {
    // Reset upload button
    uploadButton.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `;
    uploadButton.disabled = false;
    uploadButton.classList.add("has-file");
    uploadButton.title = `File: ${file.name}\nClick to remove`;
  }

  // Show document status bar
  if (documentStatusBar && documentName) {
    documentName.textContent = file.name;
    documentStatusBar.style.display = "flex";
  }
}

/**
 * Resets the file upload UI to initial state
 * @function
 */
function resetFileUploadUI() {
  const uploadButton = document.getElementById("uploadButton");
  const documentStatusBar = document.getElementById("documentStatusBar");

  if (uploadButton) {
    // Reset upload button
    uploadButton.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `;
    uploadButton.disabled = false;
    uploadButton.classList.remove("has-file");
    uploadButton.title = "Upload document";
  }

  // Hide document status bar
  if (documentStatusBar) {
    documentStatusBar.style.display = "none";
  }
}

/**
 * Removes the current uploaded file
 * @function
 */
async function removeCurrentFile() {
  currentFile = null;
  await saveFileToStorage(null);
  resetFileUploadUI();
  updateSearchPlaceholder();

  // Clear file input
  const fileInput = document.getElementById("fileInput");
  if (fileInput) {
    fileInput.value = "";
  }
}

/**
 * Saves file to storage
 * @async
 * @function
 * @param {UploadedFile|null} file - The file to save or null to clear
 */
async function saveFileToStorage(file) {
  try {
    await chrome.storage.local.set({
      magellan_uploaded_file: file,
    });
  } catch (error) {
    console.error("Error saving file to storage:", error);
  }
}

/**
 * Loads file from storage
 * @async
 * @function
 */
async function loadFileFromStorage() {
  try {
    const result = await chrome.storage.local.get(["magellan_uploaded_file"]);
    if (result.magellan_uploaded_file) {
      currentFile = result.magellan_uploaded_file;
      updateFileUploadUI(currentFile);
      updateSearchPlaceholder();
    }
  } catch (error) {
    console.error("Error loading file from storage:", error);
  }
}

/**
 * Updates the search placeholder based on current file
 * @function
 */
function updateSearchPlaceholder() {
  const searchQuery = document.getElementById("searchQuery");
  if (searchQuery) {
    if (currentFile) {
      searchQuery.placeholder = `Ask about ${currentFile.name}...`;
    } else {
      searchQuery.placeholder = "Ask about this page...";
    }
  }
}

/**
 * Formats file size for display
 * @function
 * @param {number} bytes - File size in bytes
 * @returns {string} Formatted file size
 */
function formatFileSize(bytes) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

/**
 * Gets the current uploaded file
 * @function
 * @returns {UploadedFile|null} The current file or null if none
 */
export function getCurrentFile() {
  return currentFile;
}

/**
 * Gets the text content of the current file
 * @function
 * @returns {string} The file content or empty string if no file
 */
export function getCurrentFileContent() {
  return currentFile ? currentFile.content : "";
}
