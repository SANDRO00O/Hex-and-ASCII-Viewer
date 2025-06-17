const ROW_HEIGHT = 20;
const VISIBLE_ROWS = 25;
const BUFFER_ROWS = 10;
const bytesPerRow = 16;
const CHUNK_ROWS = 5000;

let currentFile = null;
let totalRows = 0;
let lastRequest = null;

const viewer = document.getElementById('viewer');
const content = document.getElementById('content');
const dropfile = document.getElementById('dropfile');
const fileInput = document.getElementById('fileInput');
const btnSelectFile = document.getElementById('btnSelectFile');
const fileNameDisplay = document.getElementById('fileName');
const lineLoader = document.getElementById('line-loader');

// إنشاء pool لعناصر الصفوف
const poolSize = VISIBLE_ROWS + BUFFER_ROWS * 2;
const linePool = [];
for (let i = 0; i < poolSize; i++) {
  const div = document.createElement('div');
  div.className = 'line';
  div.style.position = 'absolute';
  div.style.height = `${ROW_HEIGHT}px`;
  content.appendChild(div);
  linePool.push(div);
}

// معالجة الملف المختار
function handleFile(file) {
  if (lastRequest) {
    lastRequest.abort();
    lastRequest = null;
  }

  currentFile = file;
  fileNameDisplay.textContent = file.name;
  totalRows = Math.ceil(file.size / bytesPerRow);
  content.style.height = `${totalRows * ROW_HEIGHT}px`;
  viewer.scrollTop = 0;
  renderVisibleLines();
}

// قراءة جزء من الملف
async function readChunk(offsetRow, countRows, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    
    const startByte = offsetRow * bytesPerRow;
    const endByte = Math.min(currentFile.size, startByte + countRows * bytesPerRow);
    const blob = currentFile.slice(startByte, endByte);
    const reader = new FileReader();

    reader.onload = () => {
      if (signal && signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
      
      const chunkBytes = new Uint8Array(reader.result);
      const lines = [];
      
      for (let i = 0; i < chunkBytes.length; i += bytesPerRow) {
        const rowIndex = offsetRow + Math.floor(i / bytesPerRow);
        const slice = chunkBytes.slice(i, i + bytesPerRow);
        
        let hexPart = '';
        let asciiPart = '';
        
        for (let b of slice) {
          hexPart += b.toString(16).padStart(2, '0') + ' ';
          asciiPart += (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.';
        }
        
        if (slice.length < bytesPerRow) {
          hexPart += '   '.repeat(bytesPerRow - slice.length);
          asciiPart += ' '.repeat(bytesPerRow - slice.length);
        }
        
        lines.push(`${(rowIndex * bytesPerRow).toString(16).padStart(8, '0')}: ${hexPart} ${asciiPart}`);
      }
      
      resolve(lines);
    };

    reader.onerror = () => reject(reader.error);
    reader.onabort = () => reject(new DOMException('Aborted', 'AbortError'));
    
    if (signal) {
      signal.addEventListener('abort', () => reader.abort());
    }
    
    reader.readAsArrayBuffer(blob);
  });
}

// عرض السطور المرئية
function renderVisibleLines() {
  if (!currentFile) return;
  
  const scrollTop = viewer.scrollTop;
  const firstRow = Math.floor(scrollTop / ROW_HEIGHT);
  const startRow = Math.max(0, firstRow - BUFFER_ROWS);
  const endRow = Math.min(totalRows, firstRow + VISIBLE_ROWS + BUFFER_ROWS);

  if (lastRequest) {
    lastRequest.abort();
  }

  const controller = new AbortController();
  lastRequest = controller;

  lineLoader.style.display = 'block';

  readChunk(startRow, endRow - startRow, controller.signal)
    .then(lines => {
      for (let i = 0; i < poolSize; i++) {
        const row = startRow + i;
        const div = linePool[i];
        if (row < endRow && lines[i]) {
          div.style.top = `${row * ROW_HEIGHT}px`;
          div.textContent = lines[i];
          div.style.display = 'block';
        } else {
          div.style.display = 'none';
        }
      }
      lineLoader.style.display = 'none';
    })
    .catch(err => {
      if (err.name !== 'AbortError') {
        console.error('Error rendering:', err);
        lineLoader.style.display = 'none';
      }
    });
}

// تحميل الملف كنص خام
function downloadRawTxt() {
  if (!currentFile) {
    alert('No file selected.');
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(currentFile);
  a.download = currentFile.name + '.txt';
  a.click();
  URL.revokeObjectURL(a.href);
}

// تحميل نتيجة الهيكس
async function downloadHex() {
  if (!currentFile) {
    alert('No file selected.');
    return;
  }

  try {
    lineLoader.style.display = 'block';
    const fileStream = streamSaver.createWriteStream(currentFile.name + '_hex.txt');
    const writer = fileStream.getWriter();
    const encoder = new TextEncoder();
    
    let offset = 0;
    
    while (offset < totalRows) {
      const chunkRowCount = Math.min(CHUNK_ROWS, totalRows - offset);
      const lines = await readChunk(offset, chunkRowCount);
      const text = lines.join('\n') + '\n';
      await writer.write(encoder.encode(text));
      offset += chunkRowCount;
    }
    
    await writer.close();
    lineLoader.style.display = 'none';
  } catch (err) {
    console.error('Error:', err);
    lineLoader.style.display = 'none';
  }
}

// أحداث التمرير
let ticking = false;
viewer.addEventListener('scroll', () => {
  if (!ticking) {
    requestAnimationFrame(() => {
      renderVisibleLines();
      ticking = false;
    });
    ticking = true;
  }
});

// أحداث السحب والإفلات
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

// أحداث اختيار الملف
btnSelectFile.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  if (fileInput.files.length) {
    handleFile(fileInput.files[0]);
  }
});

// تعريض الدوال للنافذة
window.downloadRawTxt = downloadRawTxt;
window.downloadHex = downloadHex;