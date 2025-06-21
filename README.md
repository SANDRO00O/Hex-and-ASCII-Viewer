# Hex + ASCII Viewer

A simple and lightweight web-based tool to view the hexadecimal and ASCII representation of any file.  
You can drag and drop a file or select it manually, then see its hex dump with ASCII side-by-side.  
Additionally, you can download the raw text or the hex output as `.txt` files.

---

### [**Live Demo**](https://sandro00o.github.io/Hex-and-ASCII-Viewer)

---

## Features

- Drag & drop file support  
- File selection via button  
- Displays file content in hex + ASCII side-by-side  
- Virtual scrolling for smooth performance with large files  
- Download the raw file content as `.txt`  
- Download the hex + ASCII output as `.txt`  

---

## How to Use

1. Open the webpage in any modern browser.  
2. Drag and drop a file into the dashed area or click **Select File** to browse.  
3. The file name will appear under the drop area.  
4. Scroll through the hex + ASCII view of the file contents.  
5. Use the buttons to download the raw file as text or the hex output.

---

## Supported Browsers

- Google Chrome  
- Mozilla Firefox  
- Microsoft Edge  
- Safari  

Any browser supporting modern HTML5 APIs such as FileReader and Blob.

---

## Installation

No installation required. Just open the `index.html` file in a browser or host it on a web server.

---

## How It Works

- Reads the file as an ArrayBuffer  
- Converts bytes into hex and ASCII representation  
- Uses virtual scrolling to render only visible lines for performance  
- Allows downloading results as text files  

---

## Developer

Developed by [Karrar](https://karrarnazim.netlify.app)

---

## License

This project is open source and available under the MIT License.