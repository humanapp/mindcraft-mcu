/** Triggers a browser download of `content` as a file of `mimeType` named `filename`. */
function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Triggers a browser download of `content` as a text file named `filename`. */
export function downloadTextFile(content: string, filename: string): void {
  downloadFile(content, filename, "application/json");
}

/** Triggers a browser download of Intel HEX `content` as a `.hex` file named `filename`. */
export function downloadHexFile(content: string, filename: string): void {
  downloadFile(content, filename, "application/octet-stream");
}
