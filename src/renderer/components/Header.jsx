import React from 'react';

export default function Header({ isListening, onToggleListening, isCollapsed, onToggleCollapse, onOpenOnboarding, statusMessage, session, onEndSession }) {
  
  const logoSvg = (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v10M7 12h10" strokeLinecap="round" />
    </svg>
  );

  return (
    <div className="header-toolbar-wrapper">
      <div id="toolbar" className="toolbar-container">
        <button 
          className="tb-logo-btn" 
          title="Open Quick Guide"
          onClick={onOpenOnboarding}
        >
          {logoSvg}
        </button>
        <div className="tb-divider"></div>
        <button 
          className={`tb-collapse-btn ${isCollapsed ? 'collapsed' : ''}`}
          onClick={onToggleCollapse}
        >
          <span className="arrow-icon"></span>
          <span>{isCollapsed ? 'Show' : 'Hide'}</span>
        </button>
        {session && session.active && (
          <>
            <div className="tb-divider"></div>
            <button
              className="tb-session-btn"
              title={`${session.turnCount} turns · ~${session.estimatedTokens} prompt tokens${session.hasSummary ? ' · summarised' : ''}`}
              onClick={onEndSession}
            >
              <span className="session-dot"></span>
              <span>End session</span>
            </button>
          </>
        )}
        <div className="tb-divider"></div>
        <button 
          className={`tb-listen-btn ${isListening ? 'active' : ''}`}
          title={isListening ? 'Stop capture' : 'Start capture'}
          onClick={onToggleListening}
        >
          <span className="status-dot"></span>
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
