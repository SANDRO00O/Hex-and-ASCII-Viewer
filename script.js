    // Constants with dynamic adjustment
    let VISIBLE_ROWS = 25;
    let BUFFER_ROWS = 10;
    let bytesPerRow = 16;
    let ROW_HEIGHT = 20;
    const CHUNK_ROWS = 5000;
    
    // App state
    let currentFile = null;
    let totalRows = 0;
    let rowCache = new Map();
    let currentSearchTerm = '';
    let searchResults = [];
    let currentResultIndex = -1;
    let worker = null;
    let searchResultMap = new Map();
    
    // DOM Elements
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
    const fileStats = document.getElementById('fileStats');
    const cacheStats = document.getElementById('cacheStats');
    const searchInput = document.getElementById('searchInput');
    const searchButton = document.getElementById('searchButton');
    const prevResultButton = document.getElementById('prevResult');
    const nextResultButton = document.getElementById('nextResult');
    const searchNav = document.getElementById('searchNav');
    const notification = document.getElementById('notification');
    
    // Line pool
    const linePool = [];
    let poolSize;
    
    // Initialize line pool
    function initLinePool() {
      // Clear existing pool
      hexContent.innerHTML = '';
      linePool.length = 0;
      
      // Calculate pool size based on visible area
      const viewerHeight = viewerContent.clientHeight;
      VISIBLE_ROWS = Math.ceil(viewerHeight / ROW_HEIGHT);
      poolSize = VISIBLE_ROWS + BUFFER_ROWS * 2;
      
      // Create new line elements
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
        
        // Cache results
        for (let i = 0; i < lines.length; i++) {
          const rowIndex = chunkIndex * CHUNK_ROWS + i;
          rowCache.set(rowIndex, lines[i]);
        }
        
        // Update cache stats
        updateCacheStats();
        
        // Render if this is the current chunk
        const firstVisibleRow = Math.floor(viewerContent.scrollTop / ROW_HEIGHT);
        const startRow = Math.max(0, firstVisibleRow - BUFFER_ROWS);
        const endRow = Math.min(totalRows, firstVisibleRow + VISIBLE_ROWS + BUFFER_ROWS);
        
        if (chunkIndex === Math.floor(startRow / CHUNK_ROWS)) {
          renderVisibleLines();
        }
      };
    }
    
    // Handle file selection
    function handleFile(file) {
      // Reset state
      currentFile = file;
      rowCache.clear();
      searchResults = [];
      searchResultMap.clear();
      currentResultIndex = -1;
      currentSearchTerm = '';
      searchInput.value = '';
      searchNav.style.display = 'none';
      
      // Update UI
      fileNameDisplay.textContent = file.name;
      fileNameDisplay.title = file.name;
      totalRows = Math.ceil(file.size / bytesPerRow);
      hexContent.style.height = `${totalRows * ROW_HEIGHT}px`;
      viewerContent.scrollTop = 0;
      
      // Update stats
      fileStats.innerHTML = `
        <div><i class="fas fa-file"></i> Size: ${formatFileSize(file.size)}</div>
        <div><i class="fas fa-list-ol"></i> Rows: ${totalRows.toLocaleString()}</div>
      `;
      
      updateCacheStats();
      
      // Initialize line pool with new settings
      initLinePool();
      
      // Render initial lines
      renderVisibleLines();
      
      // Preload first few chunks
      viewershow.style.opacity = '1';
      preloadChunks(0, 3);
      showNotification('File loaded successfully', 'success');
    }
    
    // Format file size
    function formatFileSize(bytes) {
      if (bytes < 1024) return bytes + ' bytes';
      if (bytes < 1048576) return (bytes / 1024).toFixed(2) + ' KB';
      return (bytes / 1048576).toFixed(2) + ' MB';
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
      
      // Calculate which chunk we're in
      const startChunk = Math.floor(startRow / CHUNK_ROWS);
      
      // Preload surrounding chunks
      preloadChunks(startChunk - 1, 3);
      
      // Display lines from cache
      let linesToRender = 0;
      
      for (let i = 0; i < poolSize; i++) {
        const row = startRow + i;
        const div = linePool[i];
        
        if (row < endRow) {
          const cachedLine = rowCache.get(row);
          
          if (cachedLine) {
            div.style.top = `${row * ROW_HEIGHT}px`;
            div.innerHTML = cachedLine;
            div.dataset.row = row;
            div.style.display = 'block';
            linesToRender++;
            
            // Highlight only if it's the current search result
            if (row === currentResultIndex) {
              div.classList.add('highlight');
            } else {
              div.classList.remove('highlight');
            }
          } else {
            div.textContent = 'Loading...';
            div.style.top = `${row * ROW_HEIGHT}px`;
            div.dataset.row = row;
            div.style.display = 'block';
          }
        } else {
          div.style.display = 'none';
        }
      }
      
      // If we have missing lines, load the chunk
      if (linesToRender < (endRow - startRow)) {
        const chunkIndex = Math.floor(startRow / CHUNK_ROWS);
        if (!rowCache.has(chunkIndex * CHUNK_ROWS)) {
          loadChunk(chunkIndex);
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
      
      try {
        
        lineLoader.style.display = 'block';
        progcontainer.style.display = 'block';
        showNotification('Starting hex file creation...', 'warning');
        
        const fileStream = streamSaver.createWriteStream(currentFile.name + '_hex.txt');
        const writer = fileStream.getWriter();
        const encoder = new TextEncoder();
        
        let offset = 0;
        const totalChunks = Math.ceil(totalRows / CHUNK_ROWS);
        let lastProgressUpdate = 0;
        
        for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
          
          const chunkRowCount = Math.min(CHUNK_ROWS, totalRows - offset);
          
          // Update progress with throttling
          const now = Date.now();
          if (now - lastProgressUpdate > 500) {
            const progress = Math.round((chunkIndex + 1) / totalChunks * 100);
            progressFill.style.width = `${progress}%`;
            progressText.textContent = `${progress}%`;
            lastProgressUpdate = now;
          }
          
          // Check cache first
          let allCached = true;
          for (let i = 0; i < chunkRowCount; i++) {
            if (!rowCache.has(offset + i)) {
              allCached = false;
              break;
            }
          }
          
          if (!allCached) {
            // Load chunk if not fully cached
            await new Promise(resolve => {
              const startByte = offset * bytesPerRow;
              const endByte = Math.min(currentFile.size, startByte + chunkRowCount * bytesPerRow);
              const blob = currentFile.slice(startByte, endByte);
              const reader = new FileReader();
              
              reader.onload = function() {
                const chunkBytes = new Uint8Array(reader.result);
                
                // Process in worker
                worker.postMessage({
                  chunk: chunkBytes,
                  offset: offset * bytesPerRow,
                  bytesPerRow,
                  chunkIndex
                });
                
                // Wait for worker to process
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
          
          // Build text from cache
          let hexText = '';
          for (let i = 0; i < chunkRowCount; i++) {
            const rowIndex = offset + i;
            hexText += rowCache.get(rowIndex) + '\n';
          }
          
          await writer.write(encoder.encode(hexText));
          offset += chunkRowCount;
        }
        
        await writer.close();
        lineLoader.style.display = 'none';
        showNotification('Hex file downloaded successfully', 'success');
      } catch (err) {
        console.error('Error:', err);
        lineLoader.style.display = 'none';
        progcontainer.style.display = 'none';
        showNotification('Error generating hex file: ' + err.message, 'error');
      }
    }
    
    // Search functionality with optimized approach
    function performSearch() {
      const term = searchInput.value.trim();
      
      if (!term) {
        currentSearchTerm = '';
        searchResults = [];
        searchResultMap.clear();
        currentResultIndex = -1;
        searchNav.style.display = 'none';
        document.querySelectorAll('.line.highlight').forEach(el => {
          el.classList.remove('highlight');
        });
        showNotification('Search cleared', 'warning');
        return;
      }
      
      showNotification('Searching...', 'warning');
      lineLoader.style.display = 'block';
      
      currentSearchTerm = term;
      searchResults = [];
      searchResultMap.clear();
      currentResultIndex = -1;
      
      // Search through cached rows
      setTimeout(() => {
        for (const [rowIndex, line] of rowCache.entries()) {
          if (line.includes(term)) {
            searchResults.push(rowIndex);
            searchResultMap.set(rowIndex, true);
          }
        }
        
        if (searchResults.length > 0) {
          showNotification(`Found ${searchResults.length} matches`, 'success');
          searchNav.style.display = 'flex';
          goToResult(0);
        } else {
          showNotification('No matches found', 'warning');
          searchNav.style.display = 'none';
        }
        
        lineLoader.style.display = 'none';
      }, 100);
    }
    
    // Go to specific search result
    function goToResult(index) {
      if (searchResults.length === 0) return;
      
      currentResultIndex = index;
      const row = searchResults[currentResultIndex];
      
      // Remove previous highlights
      document.querySelectorAll('.line.highlight').forEach(el => {
        el.classList.remove('highlight');
      });
      
      // Highlight current result
      const lineDiv = document.querySelector(`.line[data-row="${row}"]`);
      if (lineDiv) {
        lineDiv.classList.add('highlight');
        
        // Scroll to the result
        viewerContent.scrollTo({
          top: row * ROW_HEIGHT - (viewerContent.clientHeight / 3),
          behavior: 'smooth'
        });
      }
    }
    
    // Go to next search result
    function goToNextResult() {
      if (searchResults.length === 0) return;
      const nextIndex = (currentResultIndex + 1) % searchResults.length;
      goToResult(nextIndex);
    }
    
    // Go to previous search result
    function goToPrevResult() {
      if (searchResults.length === 0) return;
      const prevIndex = (currentResultIndex - 1 + searchResults.length) % searchResults.length;
      goToResult(prevIndex);
    }
    
    // Clear cache
    function clearCache() {
      rowCache.clear();
      updateCacheStats();
      showNotification('Cache cleared', 'success');
      renderVisibleLines();
    }
    
    // Update cache stats
    function updateCacheStats() {
      cacheStats.innerHTML = `
        <div><i class="fas fa-memory"></i> Cached: ${rowCache.size.toLocaleString()} rows</div>
      `;
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
    
    // Event Listeners with optimized scroll handling
    function setupEventListeners() {
      // Scroll event with throttling
      let lastScrollTime = 0;
      viewerContent.addEventListener('scroll', () => {
        const now = Date.now();
        if (now - lastScrollTime > 50) {
          renderVisibleLines();
          clearUnusedCache();
          lastScrollTime = now;
        }
      });
      
      // File drag and drop
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
      
      // File selection
      btnSelectFile.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', () => {
        if (fileInput.files.length) {
          handleFile(fileInput.files[0]);
        }
      });
      
      // Configuration changes
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
            hexContent.style.height = `${totalRows * ROW_HEIGHT}px`;
            renderVisibleLines();
          }
        }
      });
      
      // Search functionality
      searchButton.addEventListener('click', performSearch);
      searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') performSearch();
      });
      
      // Search navigation
      nextResultButton.addEventListener('click', goToNextResult);
      prevResultButton.addEventListener('click', goToPrevResult);
      
      // Window resize
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
    }
    
    // Initialize when page loads
    window.addEventListener('DOMContentLoaded', initApp);
    
    // Expose functions to global scope
    window.downloadRawTxt = downloadRawTxt;
    window.downloadHex = downloadHex;
    window.clearCache = clearCache;