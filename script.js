const ROW_HEIGHT = 20; // ارتفاع كل صف بالبيكسل
const VISIBLE_ROWS = 25; // عدد الصفوف الظاهرة
const BUFFER_ROWS = 10; // هامش الصفوف الزائدة للتمرير السلس
const bytesPerRow = 16; // عدد البايتات في كل صف

let currentFile = null;
let totalRows = 0;

const viewer = document.getElementById('viewer');
const content = document.getElementById('content');
const dropfile = document.getElementById('dropfile');
const fileInput = document.getElementById('fileInput');
const btnSelectFile = document.getElementById('btnSelectFile');
const fileNameDisplay = document.getElementById('fileName');

// إنشاء مسبق لعناصر الصفوف (pool)
const poolSize = VISIBLE_ROWS + BUFFER_ROWS * 2;
const linePool = [];
for (let i = 0; i < poolSize; i++) {
  const div = document.createElement('div');
  div.className = 'line';
  div.style.position = 'absolute';
  div.style.whiteSpace = 'pre';
  div.style.fontFamily = 'monospace';
  div.style.height = `${ROW_HEIGHT}px`;
  content.appendChild(div);
  linePool.push(div);
}

// عند اختيار أو إسقاط ملف
function handleFile(file) {
  currentFile = file;
  fileNameDisplay.textContent = file.name;
  totalRows = Math.ceil(file.size / bytesPerRow);
  content.style.height = `${totalRows * ROW_HEIGHT}px`;
  renderVisibleLines();
}

// قراءة chunk من الملف وتحويله إلى سطور هيكس وASCII
function readChunk(offsetRow, countRows) {
  return new Promise((resolve, reject) => {
    const startByte = offsetRow * bytesPerRow;
    const endByte = Math.min(currentFile.size, startByte + countRows * bytesPerRow);
    const blob = currentFile.slice(startByte, endByte);
    const reader = new FileReader();
    reader.onload = () => {
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
        
        const line = `${(rowIndex * bytesPerRow).toString(16).padStart(8, '0')}: ${hexPart} ${asciiPart}`;
        lines.push(line);
      }
      resolve(lines);
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(blob);
  });
}

// عرض السطور الظاهرة
function renderVisibleLines() {
  if (!currentFile) return;
  
  const scrollTop = viewer.scrollTop;
  const firstRow = Math.floor(scrollTop / ROW_HEIGHT);
  const startRow = Math.max(0, firstRow - BUFFER_ROWS);
  const endRow = Math.min(totalRows, firstRow + VISIBLE_ROWS + BUFFER_ROWS);
  
  readChunk(startRow, endRow - startRow).then(lines => {
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
  });
}

// دعم التمرير
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

// دعم السحب والإفلات
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

// زر اختيار ملف
btnSelectFile.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  if (fileInput.files.length) {
    handleFile(fileInput.files[0]);
  }
});

// تحميل raw كـ txt
function downloadRawTxt() {
  if (!currentFile) {
    alert('No file selected.');
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(currentFile);
  a.download = 'raw_output.txt';
  a.click();
  URL.revokeObjectURL(a.href);
}

// تحميل كل الهيكس
function downloadHex() {
  if (!currentFile) {
    alert('No file selected.');
    return;
  }
  
  const CHUNK_ROWS = 5000;
  let offset = 0;
  let allLines = [];
  
  function readNext() {
    if (offset >= totalRows) {
      const blob = new Blob([allLines.join('\n')], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'hex_output.txt';
      a.click();
      URL.revokeObjectURL(url);
      return;
    }
    
    readChunk(offset, CHUNK_ROWS).then(lines => {
      allLines = allLines.concat(lines);
      offset += CHUNK_ROWS;
      setTimeout(readNext, 0); // لتجنب حظر المتصفح
    });
  }
  
  readNext();
}

// ربط الأزرار
window.downloadRawTxt = downloadRawTxt;
window.downloadHex = downloadHex;