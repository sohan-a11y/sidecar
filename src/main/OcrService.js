const Tesseract = require('tesseract.js');

class OcrService {
  constructor() {
    this.worker = null;
  }

  async recognize(dataUrl) {
    if (!dataUrl) {
      throw new Error("No image data provided for OCR.");
    }
    console.log("[OcrService] Starting high-precision OCR processing...");
    try {
      const result = await Tesseract.recognize(dataUrl, 'eng', {
        logger: (m) => {
          if (m.status === 'recognizing text') {
            console.log(`[OcrService] Progress: ${Math.round(m.progress * 100)}%`);
          }
        }
      });

      let text = (result && result.data && result.data.text) ? result.data.text : "";
      
      // Clean up multiple blank lines & normalize line breaks
      text = text
        .replace(/\r\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

      const confidence = result.data ? result.data.confidence : 0;
      console.log(`[OcrService] OCR completed. Extracted ${text.length} characters with ${Math.round(confidence)}% confidence.`);
      
      return { ok: true, text, confidence };
    } catch (err) {
      console.error("[OcrService] OCR failed:", err.message);
      return { ok: false, error: err.message, text: "" };
    }
  }
}

module.exports = new OcrService();
