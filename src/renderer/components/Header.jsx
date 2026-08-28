import React from "react";

export default function Header({
  isListening,
  onToggleListening,
  isCollapsed,
  onToggleCollapse,
  onOpenOnboarding,
  statusMessage,
  session,
  onEndSession,
  autoAnswer,
  onToggleAutoAnswer,
  isBrowser,
  onToggleBrowser
}) {
  return (
    <div className="header-toolbar-wrapper">
      <div id="toolbar" className="toolbar-container">
        <button className="tb-logo-btn" aria-label="Open Quick Guide" onClick={onOpenOnboarding}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v10M7 12h10" strokeLinecap="round" />
          </svg>
        </button>

        <div className="tb-divider" />

        <button className={`tb-collapse-btn ${isCollapsed ? "collapsed" : ""}`} onClick={onToggleCollapse}>
          <span className="arrow-icon" />
          <span>{isCollapsed ? "Show" : "Hide"}</span>
        </button>

        <div className="tb-divider" />

        <button
          className={`tb-auto-btn ${autoAnswer ? "active" : ""}`}
          aria-label={autoAnswer ? "Disable auto-answer" : "Enable auto-answer"}
          onClick={onToggleAutoAnswer}
        >
          <span className="auto-dot" />
          <span>Auto</span>
        </button>

        <div className="tb-divider" />

        <button
          className={`tb-auto-btn ${isBrowser ? "active" : ""}`}
          aria-label={isBrowser ? "Switch to Sidecar Chat mode" : "Switch to Web Browser mode"}
          onClick={onToggleBrowser}
        >
          <span className="auto-dot" style={isBrowser ? { background: "#00b489", boxShadow: "0 0 8px #00b489" } : {}} />
          <span>Web</span>
        </button>

        {session && session.active && (
          <>
            <div className="tb-divider" />
            <button className="tb-session-btn" aria-label={`End session. ${session.turnCount} turns.`} onClick={onEndSession}>
              <span className="session-dot" />
              <span>End session</span>
            </button>
          </>
        )}

        <div className="tb-divider" />

        <button
          className={`tb-listen-btn ${isListening ? "active" : ""}`}
          aria-label={isListening ? "Stop capture" : "Start capture"}
          onClick={onToggleListening}
        >
          <span className="status-dot" />
        </button>
      </div>

      {statusMessage && (
        <div id="sidecar-status" className="status-message-bar show animate-fade">
          {statusMessage}
        </div>
      )}
    </div>
  );
}
