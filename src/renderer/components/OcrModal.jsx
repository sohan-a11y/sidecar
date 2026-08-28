import React, { useState } from "react";

export default function OcrModal({
  isOpen,
  onClose,
  ocrData,
  isProcessing,
  sources,
  selectedSourceId,
  onSelectSource,
  onRunOcr,
  onAskAi
}) {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleCopy = () => {
    if (ocrData && ocrData.text) {
      navigator.clipboard.writeText(ocrData.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    }
  };

  return (
    <div className="ocr-modal-scrim" onClick={onClose}>
      <div className="ocr-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="ocr-modal-header">
          <div>
            <div className="ocr-title">
              📷 Screen OCR Text Extractor
            </div>
            <div className="ocr-subtitle">
              Capture screen, extract text automatically, copy or analyze with AI
            </div>
          </div>
          <button className="modal-close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="ocr-controls-row">
          <label style={{ fontSize: "12px", color: "var(--text-muted)", fontWeight: "500" }}>
            Source Screen:
          </label>
          <select
            className="screen-select-dropdown"
            value={selectedSourceId || (sources[0] && sources[0].id) || ""}
            onChange={(e) => {
              const newSourceId = e.target.value;
              onSelectSource(newSourceId);
              onRunOcr(newSourceId);
            }}
          >
            {sources.map((src) => (
              <option key={src.id} value={src.id}>
                {src.name}
              </option>
            ))}
          </select>

          <button
            type="button"
            className="action-pill-btn"
            style={{ padding: "5px 12px", cursor: isProcessing ? "default" : "pointer" }}
            disabled={isProcessing}
            onClick={() => onRunOcr(selectedSourceId)}
          >
            {isProcessing ? "Processing OCR..." : "🔄 Capture & Re-run OCR"}
          </button>
        </div>

        <div className="ocr-body-grid">
          <div className="ocr-img-container">
            <div style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: "600", textTransform: "uppercase" }}>
              Screen Preview
            </div>
            {ocrData?.dataUrl ? (
              <img src={ocrData.dataUrl} alt="Captured Screen" className="ocr-img-preview" />
            ) : (
              <div className="ocr-img-preview" style={{ display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: "12px" }}>
                {isProcessing ? "Capturing..." : "No preview"}
              </div>
            )}
          </div>

          <div className="ocr-textarea-container">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: "600", textTransform: "uppercase" }}>
                Extracted Text (Copyable)
              </div>
              {ocrData?.confidence > 0 && (
                <div style={{ fontSize: "11px", color: "var(--accent-primary)" }}>
                  Accuracy: {Math.round(ocrData.confidence)}%
                </div>
              )}
            </div>

            <textarea
              className="ocr-textarea"
              readOnly={false}
              value={isProcessing ? "Performing OCR analysis on captured screen..." : (ocrData?.text || "No text detected on screen.")}
              onChange={() => {}}
              placeholder="OCR extracted text will appear here..."
            />
          </div>
        </div>

        <div className="ocr-actions-row">
          {copied && (
            <span style={{ fontSize: "12px", color: "var(--accent-primary)", fontWeight: "600" }}>
              ✓ Copied to Clipboard!
            </span>
          )}

          {ocrData?.text && (
            <button
              type="button"
              className="btn-ask-ocr"
              onClick={() => {
                onAskAi(ocrData.text);
                onClose();
              }}
            >
              💬 Ask Assistant about this text
            </button>
          )}

          <button
            type="button"
            className="btn-copy-ocr"
            disabled={!ocrData?.text || isProcessing}
            onClick={handleCopy}
          >
            📋 Copy Text
          </button>
        </div>
      </div>
    </div>
  );
}
