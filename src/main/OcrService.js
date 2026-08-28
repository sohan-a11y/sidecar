const Tesseract = require('tesseract.js');

class OcrService {
  constructor() {
    this.worker = null;
  }

  async recognize(dataUrl) {
    if (!dataUrl) {
      throw new Error("No image data provided for OCR.");
    }
    console.log("[OcrService] Starting OCR processing...");
    try {
      const result = await Tesseract.recognize(dataUrl, 'eng', {
        logger: (m) => {
          if (m.status === 'recognizing text') {
            console.log(`[OcrService] Progress: ${Math.round(m.progress * 100)}%`);
          }
        }
      });
      const text = (result && result.data && result.data.text) ? result.data.text.trim() : "";
      console.log(`[OcrService] OCR completed. Extracted ${text.length} characters.`);
      return { ok: true, text, confidence: result.data.confidence };
    } catch (err) {
      console.error("[OcrService] OCR failed:", err.message);
      return { ok: false, error: err.message, text: "" };
    }
  }
}

module.exports = new OcrService();
