    // Constants with dynamic adjustment
    let VISIBLE_ROWS = 25;
    let BUFFER_ROWS = 10;
    let bytesPerRow = 16;
    let ROW_HEIGHT = 20;
    const CHUNK_ROWS = 5000;
    const MAX_FILE_SIZE = 1024 * 1024 * 1024; // 1GB
    
    // App state
    let activeOperations = 0;
    let lastOperationId = 0;
    let currentFile = null;
    let totalRows = 0;
    let rowCache = new Map();
    let currentSearchTerm = '';
    let searchResults = [];
    let currentResultIndex = -1;
    let worker = null;
    let isSearching = false;
    let searchMatches = new Map();
    let lastSearchOptions = {};
    let searchCancelled = false;
    let dotCount = 0;
    let dotInterval;
    
    // DOM Elements
    const dots = document.getElementById('dots');
    const progcontainer = document.getElementById('progress-container');
    
    const viewershow = document.getElementById('viewer');
    const viewerContent = document.getElementById('viewer-content');
    const hexContent = document.getElementById('hex-content');
    const dropfile = document.getElementById('dropfile');
    const fileInput = document.getElementById('fileInput');
    const btnSelectFile = document.getElementById('btnSelectFile');
    const fileNameDisplay = document.getElementById('fileName');
    const lineLoader = document.getElementById('line-loader');
    const progressFill = document.getElementById('progress-fill');
    const progressText = document.getElementById('progressText');
    const bytesPerRowInput = document.getElementById('bytesPerRow');
    const rowHeightInput = document.getElementById('rowHeight');
    const fileSizeDisplay = document.getElementById('fileSize');
    const fileRowsDisplay = document.getElementById('fileRows');
    const cachedRowsDisplay = document.getElementById('cachedRows');
    const searchInput = document.getElementById('searchInput');
    const searchButton = document.getElementById('searchButton');
    const prevResultButton = document.getElementById('prevResult');
    const nextResultButton = document.getElementById('nextResult');
    const clearSearchButton = document.getElementById('clearSearch');
    const searchNav = document.getElementById('searchNav');
    const notification = document.getElementById('notification');
    const doneprogress = document.getElementById('done');
    const downloadWarning = document.getElementById('download-warning');
    const fileSizeWarning = document.getElementById('file-size-warning');
    const caseSensitiveCheck = document.getElementById('caseSensitive');
    const hexSearchCheck = document.getElementById('hexSearch');
    const searchResultsInfo = document.getElementById('searchResultsInfo');
    const currentMatchSpan = document.getElementById('currentMatch');
    const totalMatchesSpan = document.getElementById('totalMatches');
    const cancelSearchButton = document.getElementById('cancelSearch');
    
    document.addEventListener('DOMContentLoaded', () => {
      dotInterval = setInterval(() => {
        dotCount = (dotCount + 1) % 4;
        dots.textContent = '.'.repeat(dotCount);
      }, 500);
    });
    // Line pool
    const linePool = [];
    let poolSize;
    
    // Initialize line pool
    function initLinePool() {
      hexContent.innerHTML = '';
      linePool.length = 0;
      
      const viewerHeight = viewerContent.clientHeight;
      VISIBLE_ROWS = Math.ceil(viewerHeight / ROW_HEIGHT);
      poolSize = VISIBLE_ROWS + BUFFER_ROWS * 2;
      
      for (let i = 0; i < poolSize; i++) {
        const div = document.createElement('div');
        div.className = 'line';
        div.style.position = 'absolute';
        div.style.height = `${ROW_HEIGHT}px`;
        hexContent.appendChild(div);
        linePool.push(div);
      }
    }
    
    // Initialize Web Worker
    function initWorker() {
      if (worker) worker.terminate();
      
      const workerCode = `
    self.onmessage = function(e) {
      const { chunk, offset, bytesPerRow } = e.data;
      const result = [];
      
      for (let i = 0; i < chunk.length; i += bytesPerRow) {
        const rowIndex = offset + Math.floor(i / bytesPerRow);
        const slice = chunk.slice(i, i + bytesPerRow);
        
        let hexPart = '';
        let asciiPart = '';
        
        for (let j = 0; j < slice.length; j++) {
          const b = slice[j];
          const hexByte = b.toString(16).padStart(2, '0');
          hexPart += hexByte + ' ';
          asciiPart += (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.';
        }
        
        if (slice.length < bytesPerRow) {
          hexPart += '   '.repeat(bytesPerRow - slice.length);
          asciiPart += ' '.repeat(bytesPerRow - slice.length);
        }
        
        const offsetStr = (rowIndex * bytesPerRow).toString(16).padStart(8, '0');
        result.push(\`\${offsetStr}: \${hexPart} \${asciiPart}\`);
      }
      
      self.postMessage({ 
        lines: result,
        chunkIndex: e.data.chunkIndex
      });
    };
  `;
      
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      worker = new Worker(URL.createObjectURL(blob));
      
      worker.onmessage = function(e) {
        const { lines, chunkIndex } = e.data;
        
        for (let i = 0; i < lines.length; i++) {
          const rowIndex = chunkIndex * CHUNK_ROWS + i;
          rowCache.set(rowIndex, lines[i]);
        }
        
        updateCacheStats();
        
        const firstVisibleRow = Math.floor(viewerContent.scrollTop / ROW_HEIGHT);
        const startRow = Math.max(0, firstVisibleRow - BUFFER_ROWS);
        const endRow = Math.min(totalRows, firstVisibleRow + VISIBLE_ROWS + BUFFER_ROWS);
        
        if (chunkIndex === Math.floor(startRow / CHUNK_ROWS)) {
          renderVisibleLines();
        }
      };
    }
    
    // Create bad character table for BMH algorithm
    function createBadCharTable(pattern) {
      const table = {};
      const patternLength = pattern.length;
      
      for (let i = 0; i < patternLength - 1; i++) {
        table[pattern[i]] = patternLength - i - 1;
      }
      
      // Default shift is the pattern length
      table.default = patternLength;
      return table;
    }
    
    // Convert hex string to bytes
    function hexStringToBytes(hex) {
      const bytes = [];
      hex = hex.replace(/\s+/g, ''); // Remove any spaces
      
      for (let i = 0; i < hex.length; i += 2) {
        const byte = parseInt(hex.substr(i, 2), 16);
        if (!isNaN(byte)) {
          bytes.push(byte);
        }
      }
      
      return bytes;
    }
    
    // Convert bytes to text with case handling
    function bytesToText(bytes, caseSensitive) {
      const decoder = new TextDecoder('utf-8', { fatal: false });
      let text = decoder.decode(new Uint8Array(bytes));
      
      if (!caseSensitive) {
        text = text.toLowerCase();
      }
      
      return text;
    }
    
    // Streaming search for large files
    async function streamingSearch(file, pattern, options, operationId) {
      const CHUNK_SIZE = 1024 * 1024 * 10; // 10MB chunks
      const patternLength = pattern.length;
      const fileSize = file.size;
      
      // Handle hex search
      let searchBytes = [];
      if (options.hexSearch) {
        searchBytes = hexStringToBytes(pattern);
      } else {
        const encoder = new TextEncoder();
        searchBytes = Array.from(encoder.encode(pattern));
        
        if (!options.caseSensitive) {
          const lowerPattern = pattern.toLowerCase();
          searchBytes = Array.from(encoder.encode(lowerPattern));
        }
      }
      
      // Create bad character table
      const badCharTable = createBadCharTable(searchBytes);
      
      let position = 0;
      let remainingBuffer = new Uint8Array(0);
      let globalPosition = 0;
      
      while (position < fileSize && !searchCancelled) {
        // Read chunk
        const chunk = file.slice(position, Math.min(position + CHUNK_SIZE, fileSize));
        const arrayBuffer = await readChunk(chunk);
        const chunkData = new Uint8Array(arrayBuffer);
        
        // Merge with remaining from previous chunk
        const combinedData = mergeBuffers(remainingBuffer, chunkData);
        
        // Search in current chunk
        const searchResult = searchInChunk(combinedData, searchBytes, badCharTable, globalPosition, options);
        
        // Add matches to results
        searchResults.push(...searchResult.matches);
        
        // Save remaining for next chunk
        const overlapSize = Math.max(patternLength - 1, 0);
        remainingBuffer = combinedData.slice(combinedData.length - overlapSize);
        globalPosition = searchResult.nextStartPosition;
        
        // Update position
        position += CHUNK_SIZE - overlapSize;
        
        // Update progress
        updateSearchProgress(position, fileSize, operationId);
      }
    }
    
    // Helper to read chunk
    function readChunk(chunk) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsArrayBuffer(chunk);
      });
    }
    
    // Merge buffers
    function mergeBuffers(prev, current) {
      const merged = new Uint8Array(prev.length + current.length);
      merged.set(prev);
      merged.set(current, prev.length);
      return merged;
    }
    
    // Search in a chunk with case sensitivity and hex search options
    function searchInChunk(buffer, pattern, badCharTable, startPosition, options) {
      const matches = [];
      const bufferLength = buffer.length;
      const patternLength = pattern.length;
      
      let i = 0;
      
      while (i <= bufferLength - patternLength) {
        let match = true;
        
        for (let j = patternLength - 1; j >= 0; j--) {
          let bufferByte = buffer[i + j];
          const patternByte = pattern[j];
          
          // Handle case insensitivity for text search
          if (!options.hexSearch && !options.caseSensitive) {
            // Convert to lowercase if it's an uppercase letter
            if (bufferByte >= 65 && bufferByte <= 90) {
              bufferByte += 32; // to lowercase
            }
          }
          
          if (bufferByte !== patternByte) {
            match = false;
            // Use bad character heuristic
            const shift = badCharTable[buffer[i + patternLength - 1]] || patternLength;
            i += shift;
            break;
          }
        }
        
        if (match) {
          matches.push({
            position: startPosition + i,
            length: patternLength
          });
          i += patternLength; // Move to next possible position
        }
      }
      
      return {
        matches,
        nextStartPosition: startPosition + bufferLength
      };
    }
    
    // Update search progress
    function updateSearchProgress(position, totalSize, operationId) {
      if (operationId !== lastOperationId) return; // Ignore updates from old operations
      
      const percent = Math.min(100, Math.round((position / totalSize) * 100));
      progressFill.style.width = `${percent}%`;
      progressText.textContent = `${percent}%`;
    }
    
    // Perform search using optimized algorithm
    async function performSearch() {
      const term = searchInput.value.trim();
      
      if (!term) {
        clearSearch();
        return;
      }
      
      if (!currentFile) {
        showNotification('No file selected', 'error');
        return;
      }
      
      if (isSearching) {
        showNotification('Search already in progress', 'warning');
        return;
      }
      
      if (activeOperations > 0) {
        showNotification('Another operation is in progress', 'warning');
        return;
      }
      
      activeOperations++;
      const operationId = ++lastOperationId;
      
      // Show search in progress UI
      searchCancelled = false;
      isSearching = true;
      cancelSearchButton.style.display = 'block';
      lineLoader.style.display = 'flex';
      viewerContent.classList.add('active');
      searchResults = [];
      searchMatches.clear();
      currentResultIndex = -1;
      progcontainer.style.display = 'block';
      doneprogress.style.display = 'none';
      
      downloadWarning.style.display = 'none';
      progcontainer.style.opacity = '1';
      progressFill.style.width = '0%';
      progressText.textContent = '0%';
      
      // Store search options
      lastSearchOptions = {
        caseSensitive: caseSensitiveCheck.checked,
        hexSearch: hexSearchCheck.checked
      };
      
      showNotification('Searching...', 'info');
      dots.style.opacity = '1';
      try {
        // Perform streaming search
        await streamingSearch(currentFile, term, lastSearchOptions, operationId);
        
        if (searchCancelled) {
          showNotification('Search cancelled', 'warning');
          return;
        }
        
        totalMatchesSpan.textContent = searchResults.length.toLocaleString();
        currentMatchSpan.textContent = searchResults.length > 0 ? '1' : '0';
        
        if (searchResults.length > 0) {
          searchResultsInfo.style.display = 'block';
          doneprogress.style.display = 'block';
          dots.style.opacity = '0';
          searchNav.style.display = 'flex';
          currentResultIndex = 0;
          highlightSearchResult(currentResultIndex);
          showNotification(`Found ${searchResults.length.toLocaleString()} matches`, 'success');
          
          // Group matches by row for highlighting
          searchMatches.clear();
          searchResults.forEach(match => {
            const row = Math.floor(match.position / bytesPerRow);
            if (!searchMatches.has(row)) {
              searchMatches.set(row, []);
            }
            searchMatches.get(row).push(match);
          });
        } else {
          showNotification('No matches found', 'warning');
          searchResultsInfo.style.display = 'none';
          searchNav.style.display = 'none';
          currentResultIndex = -1;
        }
      } catch (error) {
        console.error('Search error:', error);
        showNotification('Search failed: ' + error.message, 'error');
      } finally {
        isSearching = false;
        viewerContent.classList.remove('active');
        lineLoader.style.display = 'none';
        cancelSearchButton.style.display = 'none';
        activeOperations--;
      }
    }
    
    // Handle file selection
    function handleFile(file) {
      if (file.size > MAX_FILE_SIZE) {
        showNotification('File is too large', 'error');
        fileSizeWarning.style.display = 'block';
        return;
      }
      
      fileSizeWarning.style.display = 'none';
      currentFile = file;
      rowCache.clear();
      searchResults = [];
      searchMatches.clear();
      currentResultIndex = -1;
      currentSearchTerm = '';
      searchInput.value = '';
      searchNav.style.display = 'none';
      searchResultsInfo.style.display = 'none';
      progcontainer.style.display = 'none';
      viewershow.classList.add('show');
      fileNameDisplay.style.display = 'block';
      fileNameDisplay.textContent = file.name;
      fileNameDisplay.title = file.name;
      totalRows = Math.ceil(file.size / bytesPerRow);
      hexContent.style.height = `${totalRows * ROW_HEIGHT}px`;
      viewerContent.scrollTop = 0;
      
      fileSizeDisplay.textContent = formatFileSize(file.size);
      fileRowsDisplay.textContent = totalRows.toLocaleString();
      updateCacheStats();
      
      initLinePool();
      renderVisibleLines();
      
      preloadChunks(0, 3);
      showNotification('File loaded successfully', 'success');
      
    }
    
    // Format file size
    function formatFileSize(bytes) {
      if (bytes < 1024) return bytes + ' bytes';
      if (bytes < 1048576) return (bytes / 1024).toFixed(2) + ' KB';
      if (bytes < 1073741824) return (bytes / 1048576).toFixed(2) + ' MB';
      return (bytes / 1073741824).toFixed(2) + ' GB';
    }
    
    // Preload chunks around the current position
    function preloadChunks(startChunk, count) {
      const endChunk = Math.min(Math.ceil(totalRows / CHUNK_ROWS), startChunk + count);
      
      for (let chunkIndex = startChunk; chunkIndex < endChunk; chunkIndex++) {
        if (!rowCache.has(chunkIndex * CHUNK_ROWS)) {
          loadChunk(chunkIndex);
        }
      }
    }
    
    // Load a chunk of data
    function loadChunk(chunkIndex) {
      if (!currentFile) return;
      
      const startRow = chunkIndex * CHUNK_ROWS;
      const rowCount = Math.min(CHUNK_ROWS, totalRows - startRow);
      const startByte = startRow * bytesPerRow;
      const endByte = Math.min(currentFile.size, startByte + rowCount * bytesPerRow);
      const blob = currentFile.slice(startByte, endByte);
      const reader = new FileReader();
      
      reader.onload = function() {
        const chunkBytes = new Uint8Array(reader.result);
        
        if (worker) {
          worker.postMessage({
            chunk: chunkBytes,
            offset: startRow * bytesPerRow,
            bytesPerRow,
            chunkIndex
          });
        }
      };
      
      reader.readAsArrayBuffer(blob);
    }
    
    // Render visible lines with optimized approach
    function renderVisibleLines() {
      if (!currentFile) return;
      
      const scrollTop = viewerContent.scrollTop;
      const firstRow = Math.floor(scrollTop / ROW_HEIGHT);
      const startRow = Math.max(0, firstRow - BUFFER_ROWS);
      const endRow = Math.min(totalRows, firstRow + VISIBLE_ROWS + BUFFER_ROWS);
      
      const startChunk = Math.floor(startRow / CHUNK_ROWS);
      preloadChunks(startChunk - 1, 3);
      
      for (let i = 0; i < poolSize; i++) {
        const row = startRow + i;
        const div = linePool[i];
        
        if (row < endRow) {
          const cachedLine = rowCache.get(row);
          
          if (cachedLine) {
            div.style.top = `${row * ROW_HEIGHT}px`;
            div.dataset.row = row;
            div.style.display = 'block';
            
            // Remove any existing highlight indicator
            const existingIndicator = div.querySelector('.highlight-indicator');
            if (existingIndicator) {
              existingIndicator.remove();
            }
            
            // Apply highlighting for search matches
            if (searchMatches.has(row)) {
              const matches = searchMatches.get(row);
              let highlightedLine = cachedLine;
              let offset = 0;
              
              // Sort matches by position (right to left) to avoid offset issues
              matches.sort((a, b) => b.position - a.position).forEach(match => {
                // Calculate the start position in the line
                const byteOffset = match.position % bytesPerRow;
                
                // Hex part starts at position 10 and is 3*bytesPerRow characters long
                const hexStart = 10 + (byteOffset * 3);
                const hexEnd = hexStart + (match.length * 3) - 1;
                
                // ASCII part starts after hex part + 2 spaces
                const asciiStart = 10 + (bytesPerRow * 3) + 2 + byteOffset;
                const asciiEnd = asciiStart + match.length;
                
                // Highlight hex part
                const beforeHex = highlightedLine.substring(0, hexStart + offset);
                const matchHex = highlightedLine.substring(hexStart + offset, hexEnd + offset);
                const afterHex = highlightedLine.substring(hexEnd + offset);
                highlightedLine = beforeHex +
                  `<span class="match-highlight">${matchHex}</span>` +
                  afterHex;
                offset += 39; // Length of the highlight tag
                
                // Highlight ASCII part
                const beforeAscii = highlightedLine.substring(0, asciiStart + offset);
                const matchAscii = highlightedLine.substring(asciiStart + offset, asciiEnd + offset);
                const afterAscii = highlightedLine.substring(asciiEnd + offset);
                highlightedLine = beforeAscii +
                  `<span class="match-highlight">${matchAscii}</span>` +
                  afterAscii;
                offset += 39; // Length of the highlight tag
              });
              
              div.innerHTML = highlightedLine;
              
              // Add indicator for current row highlight
              if (currentResultIndex >= 0 && searchResults[currentResultIndex] &&
                Math.floor(searchResults[currentResultIndex].position / bytesPerRow) === row) {
                const indicator = document.createElement('div');
                indicator.className = 'highlight-indicator';
                indicator.textContent = 'found';
                div.appendChild(indicator);
              }
            } else {
              div.textContent = cachedLine;
            }
          } else {
            div.textContent = 'loading...';
            div.style.top = `${row * ROW_HEIGHT}px`;
            div.dataset.row = row;
            div.style.display = 'block';
          }
        } else {
          div.style.display = 'none';
        }
      }
    }
    
    // Clear unused cache to free memory
    function clearUnusedCache() {
      const scrollTop = viewerContent.scrollTop;
      const firstRow = Math.floor(scrollTop / ROW_HEIGHT);
      const startRow = Math.max(0, firstRow - BUFFER_ROWS * 3);
      const endRow = Math.min(totalRows, firstRow + VISIBLE_ROWS + BUFFER_ROWS * 3);
      
      rowCache.forEach((_, row) => {
        if (row < startRow || row > endRow) {
          rowCache.delete(row);
        }
      });
      
      updateCacheStats();
    }
    
    // Download as raw text
    function downloadRawTxt() {
      if (!currentFile) {
        showNotification('No file selected', 'error');
        return;
      }
      
      const a = document.createElement('a');
      a.href = URL.createObjectURL(currentFile);
      a.download = currentFile.name + '.txt';
      a.click();
      URL.revokeObjectURL(a.href);
      
      showNotification('File downloaded as text', 'success');
    }
    
    // Download hex result with optimized progress updates
    async function downloadHex() {
      if (!currentFile) {
        showNotification('No file selected', 'error');
        return;
      }
      
      if (activeOperations > 0) {
        showNotification('Another operation is in progress', 'error');
        return;
      }
      
      activeOperations++;
      const operationId = ++lastOperationId;
      
      const includeHex = document.getElementById('hexOption').checked;
      const includeAscii = document.getElementById('asciiOption').checked;
      
      if (!includeHex && !includeAscii) {
        showNotification('Please select at least one option (Hex or ASCII)', 'error');
        activeOperations--;
        return;
      }
      
      try {
        lineLoader.style.display = 'flex';
        viewerContent.classList.add('active');
        progcontainer.style.display = 'block';
        progcontainer.style.opacity = '1';
        downloadWarning.style.display = 'block';
        doneprogress.style.display = 'none';
        dots.style.opacity = '1';
        showNotification('Creating compressed hex file...', 'info');
        
        const zip = new JSZip();
        let hexText = '';
        const totalChunks = Math.ceil(totalRows / CHUNK_ROWS);
        let lastProgressUpdate = 0;
        
        for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
          // Check if this operation has been superseded by a new one
          if (operationId !== lastOperationId) {
            showNotification('Download cancelled by new operation', 'warning');
            break;
          }
          
          const now = Date.now();
          if (now - lastProgressUpdate > 500) {
            const progress = Math.min(100, Math.round((chunkIndex + 1) / totalChunks * 100));
            progressFill.style.width = `${progress}%`;
            progressText.textContent = `${progress}%`;
            lastProgressUpdate = now;
          }
          
          let allCached = true;
          for (let i = 0; i < Math.min(CHUNK_ROWS, totalRows - chunkIndex * CHUNK_ROWS); i++) {
            if (!rowCache.has(chunkIndex * CHUNK_ROWS + i)) {
              allCached = false;
              break;
            }
          }
          
          if (!allCached) {
            await new Promise(resolve => {
              const startRow = chunkIndex * CHUNK_ROWS;
              const rowCount = Math.min(CHUNK_ROWS, totalRows - startRow);
              const startByte = startRow * bytesPerRow;
              const endByte = Math.min(currentFile.size, startByte + rowCount * bytesPerRow);
              const blob = currentFile.slice(startByte, endByte);
              const reader = new FileReader();
              
              reader.onload = function() {
                const chunkBytes = new Uint8Array(reader.result);
                
                worker.postMessage({
                  chunk: chunkBytes,
                  offset: startRow * bytesPerRow,
                  bytesPerRow,
                  chunkIndex
                });
                
                const handler = function(e) {
                  if (e.data.chunkIndex === chunkIndex) {
                    worker.removeEventListener('message', handler);
                    resolve();
                  }
                };
                
                worker.addEventListener('message', handler);
              };
              
              reader.readAsArrayBuffer(blob);
            });
          }
          
          for (let i = 0; i < Math.min(CHUNK_ROWS, totalRows - chunkIndex * CHUNK_ROWS); i++) {
            const rowIndex = chunkIndex * CHUNK_ROWS + i;
            const line = rowCache.get(rowIndex);
            
            if (line) {
              if (includeHex && includeAscii) {
                hexText += line + '\n';
              } else if (includeHex) {
                const hexOnly = line.split('  ')[0];
                hexText += hexOnly + '\n';
              } else if (includeAscii) {
                const parts = line.split(': ');
                const asciiOnly = parts[0] + ': ' + line.split('  ')[1];
                hexText += asciiOnly + '\n';
              }
            }
          }
        }
        
        zip.file(currentFile.name + '_hex.txt', hexText);
        
        const compressedBlob = await zip.generateAsync({
          type: 'blob',
          compression: 'DEFLATE',
          compressionOptions: {
            level: 9
          }
        });
        
        const a = document.createElement('a');
        a.href = URL.createObjectURL(compressedBlob);
        a.download = currentFile.name + '_hex.zip';
        a.click();
        URL.revokeObjectURL(a.href);
        
        showNotification('Compressed hex file downloaded', 'success');
      } catch (err) {
        console.error('Error:', err);
        showNotification('Error generating hex file: ' + err.message, 'error');
      } finally {
        lineLoader.style.display = 'none';
        viewerContent.classList.remove('active');
        doneprogress.style.display = 'block';
        dots.style.opacity = '0';
        downloadWarning.style.display = 'none';
        activeOperations--;
      }
    }
    
    // Highlight a specific search result
    function highlightSearchResult(index) {
      if (searchResults.length === 0 || index < 0 || index >= searchResults.length) return;
      
      currentResultIndex = index;
      currentMatchSpan.textContent = (index + 1).toLocaleString();
      
      const result = searchResults[index];
      const row = Math.floor(result.position / bytesPerRow);
      
      // Scroll to the result
      viewerContent.scrollTo({
        top: row * ROW_HEIGHT - (viewerContent.clientHeight / 3),
        behavior: 'smooth'
      });
      
      // Re-render to update highlights
      renderVisibleLines();
    }
    
    // Go to next search result
    function goToNextResult() {
      if (searchResults.length === 0) return;
      const nextIndex = (currentResultIndex + 1) % searchResults.length;
      highlightSearchResult(nextIndex);
    }
    
    // Go to previous search result
    function goToPrevResult() {
      if (searchResults.length === 0) return;
      const prevIndex = (currentResultIndex - 1 + searchResults.length) % searchResults.length;
      highlightSearchResult(prevIndex);
    }
    
    // Clear search
    function clearSearch() {
      currentSearchTerm = '';
      searchInput.value = '';
      searchResults = [];
      searchMatches.clear();
      currentResultIndex = -1;
      searchNav.style.display = 'none';
      searchResultsInfo.style.display = 'none';
      document.querySelectorAll('.match-highlight').forEach(el => {
        el.replaceWith(el.textContent);
      });
      showNotification('Search cleared', 'warning');
      renderVisibleLines();
    }
    
    // Clear cache
    
    function clearCache() {
      rowCache.clear();
      updateCacheStats();
      showNotification('Cache cleared', 'success');
      renderVisibleLines();
    }
    
    // Cancel search
    function cancelSearch() {
      searchCancelled = true;
      isSearching = false;
      cancelSearchButton.style.display = 'none';
      lineLoader.style.display = 'none';
      viewerContent.classList.remove('active');
      progcontainer.style.display = 'none';
      doneprogress.style.display = 'none';
      showNotification('Search cancelled', 'warning');
    }
    
    // Update cache stats
    function updateCacheStats() {
      cachedRowsDisplay.textContent = rowCache.size.toLocaleString() + ' rows';
    }
    
    // Show notification
    let isPlaying = false;
    
    function showNotification(message, type) {
      if (isPlaying) return;
      isPlaying = true;
      notification.textContent = message;
      notification.className = `notification ${type} show`;
      
      setTimeout(() => {
        isPlaying = false;
        notification.classList.remove('show');
      }, 3000);
    }
    
    //update rows and byets
    
    
    
    
    // Event Listeners with optimized scroll handling
    function setupEventListeners() {
      let lastScrollTime = 0;
      viewerContent.addEventListener('scroll', () => {
        const now = Date.now();
        if (now - lastScrollTime > 50) {
          renderVisibleLines();
          clearUnusedCache();
          lastScrollTime = now;
        }
      });
      
      dropfile.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropfile.classList.add('dragover');
      });
      
      dropfile.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dropfile.classList.remove('dragover');
      });
      
      dropfile.addEventListener('drop', (e) => {
        e.preventDefault();
        dropfile.classList.remove('dragover');
        if (e.dataTransfer.files.length) {
          handleFile(e.dataTransfer.files[0]);
        }
      });
      
      btnSelectFile.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', () => {
        if (fileInput.files.length) {
          handleFile(fileInput.files[0]);
        }
      });
      
      bytesPerRowInput.addEventListener('change', () => {
        const newValue = parseInt(bytesPerRowInput.value);
        if (newValue >= 8 && newValue <= 32) {
          bytesPerRow = newValue;
          if (currentFile) handleFile(currentFile);
        }
      });
      
      rowHeightInput.addEventListener('change', () => {
        const newValue = parseInt(rowHeightInput.value);
        if (newValue >= 15 && newValue <= 40) {
          ROW_HEIGHT = newValue;
          initLinePool();
          if (currentFile) {
            viewerContent.style.height = `${totalRows * ROW_HEIGHT}px`;
            renderVisibleLines();
          }
        }
      });
      
      searchButton.addEventListener('click', performSearch);
      searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') performSearch();
      });
      
      nextResultButton.addEventListener('click', goToNextResult);
      prevResultButton.addEventListener('click', goToPrevResult);
      clearSearchButton.addEventListener('click', clearSearch);
      cancelSearchButton.addEventListener('click', cancelSearch);
      
      window.addEventListener('resize', () => {
        initLinePool();
        if (currentFile) renderVisibleLines();
      });
      
      
    }
    
    // Initialize app
    function initApp() {
      initWorker();
      initLinePool();
      setupEventListeners();
      fileSizeWarning.style.display = 'none';
    }
    
    // Initialize when page loads
    window.addEventListener('DOMContentLoaded', initApp);
    
    // Expose functions to global scope
    window.downloadRawTxt = downloadRawTxt;
    window.downloadHex = downloadHex;
    window.clearCache = clearCache;
    window.cancelSearch = cancelSearch;