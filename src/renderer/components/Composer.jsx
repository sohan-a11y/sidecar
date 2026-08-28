import React, { useRef, useEffect } from "react";

export default function Composer({
  userText,
  setUserText,
  isSmart,
  onToggleSmart,
  onOpenSettings,
  onSubmit,
  usage,
  hasProfile,
  isStreaming,
  isQueued,
  onStop,
  onRegenerate,
  onNewThread,
  canRegenerate,
  onOpenOcr,
  onCaptureScreenshot
}) {
  const textareaRef = useRef(null);

  useEffect(() => {
    adjustHeight();
  }, [userText]);

  const adjustHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
  };

  const isLowBudget = usage && (usage.remainingDay <= usage.rpd * 0.5 || usage.queued > 0 || usage.throttledUntil);
  const budgetClass = usage ? (usage.remainingDay === 0 ? "is-empty" : usage.remainingDay <= 10 ? "is-low" : "") : "";

  return (
    <div className="composer-container no-drag">
      <div className="input-textarea-wrapper">
        <textarea
          ref={textareaRef}
          rows="1"
          placeholder="Ask a question... (Enter to submit)"
          value={userText}
          onChange={(e) => setUserText(e.target.value)}
          onKeyDown={handleKeyDown}
          className="composer-textarea"
        />
      </div>

      <div className="composer-toolbar-bottom">
        <button className={`smart-toggle-pill ${isSmart ? "active" : ""}`} onClick={onToggleSmart}>
          <span className="smart-indicator-glow" />
          <span>Smart Mode</span>
        </button>

        {onCaptureScreenshot && (
          <button
            type="button"
            className="composer-action-btn"
            title="Capture Screen"
            onClick={onCaptureScreenshot}
            style={{ fontSize: "12px", display: "flex", alignItems: "center", gap: "4px", padding: "4px 8px" }}
          >
            <span>📸</span>
          </button>
        )}

        {onOpenOcr && (
          <button
            type="button"
            className="composer-action-btn"
            title="Capture Screen OCR"
            onClick={onOpenOcr}
            style={{ fontSize: "12px", display: "flex", alignItems: "center", gap: "4px", padding: "4px 8px", background: "#e0a45822", borderColor: "#e0a45866" }}
          >
            <span>📷 OCR</span>
          </button>
        )}

        <button
          type="button"
          className={`context-pill ${hasProfile ? "is-active" : ""}`}
          aria-label={hasProfile ? "Answers use your profile. Click to review it." : "No profile loaded. Click to add your resume."}
          onClick={onOpenSettings}
        >
          {hasProfile ? "Profile on" : "No profile"}
        </button>

        <button className="composer-action-btn" aria-label="Open Settings" onClick={onOpenSettings}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>

        {isLowBudget && (
          <span className={`budget-pill ${budgetClass}`}>
            {usage.queued > 0 ? `${usage.queued} queued · ` : ""}
            {usage.remainingDay} left today
          </span>
        )}

        {canRegenerate && !isStreaming && (
          <div className="regen-group">
            <button type="button" className="link-btn" onClick={() => onRegenerate()}>
              Retry
            </button>
          </div>
        )}

        {isQueued && <span className="queue-pill">queued</span>}

        <div className="spacer" />

        <button type="button" className="link-btn" onClick={onNewThread}>
          New thread
        </button>

        {isStreaming ? (
          <button type="button" className="composer-stop-btn" onClick={onStop}>
            <span className="stop-square" />
          </button>
        ) : (
          <button className="composer-send-btn" onClick={onSubmit}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
