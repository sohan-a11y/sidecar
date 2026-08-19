import React, { useState } from 'react';

// Detect platform for shortcut display: show Ctrl on Windows, ⌘ on macOS
const isMac = typeof navigator !== 'undefined' &&
  (navigator.userAgentData?.platform === 'macOS' || /Mac/.test(navigator.platform));
const modKey = isMac ? 'Cmd' : 'Ctrl';
const modSymbol = isMac ? '⌘' : 'Ctrl';

const ONBOARD_STEPS = [
  {
    icon: '1',
    title: 'Welcome to Sidecar',
    body: 'Sidecar is a private overlay copilot that floats on your screen. It can review your screen, listen to calls, and assist with real-time advice or coding suggestions while staying hidden from screen shares.'
  },
  {
    icon: '2',
    title: 'Configure Permissions',
    body: isMac
      ? 'To enable capture features, Sidecar requires standard macOS permissions. If prompted, please click Allow, or toggle them manually in System Settings.'
      : 'Sidecar uses standard Windows APIs for screen capture and microphone access. You may see permission prompts from Windows — please click Allow to enable capture features.',
    buttons: isMac
      ? [
          { label: 'Microphone Privacy Settings', action: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone' },
          { label: 'Screen Recording Privacy Settings', action: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture' }
        ]
      : undefined
  },
  {
    icon: '3',
    title: 'Add API Credentials',
    body: 'Sidecar connects directly to your own provider keys — OpenAI, Anthropic, Gemini, TokenRouter, or any OpenAI-compatible endpoint including a local one — so you only pay for what you use. Keys are encrypted with your OS keychain and are never sent anywhere except to that provider.'
  },
  {
    icon: '4',
    title: 'What leaves your machine',
    body: 'There is no Sidecar server. Audio goes to the transcription provider you choose, only while capture is on. Screenshots go to your chat provider, only when a mode needs one. Transcripts, your profile and your settings are stored locally in your user data folder, and Settings has a delete button for each of them. Nothing is uploaded for training, analytics or crash reporting.',
    buttons: [
      { label: 'Read the full privacy statement', action: 'https://github.com/sohan-a11y/sidecar/blob/main/PRIVACY.md' }
    ]
  },
  {
    icon: '5',
    title: isMac ? 'Zoom Invisibility' : 'Screen Share Invisibility',
    body: isMac
      ? 'Sidecar is automatically hidden in Google Meet and Microsoft Teams. For Zoom, go to Zoom Settings > Share Screen > Advanced and choose "Advanced capture with window filtering" to protect overlay privacy.'
      : 'Sidecar uses Windows content protection to hide from most screen capture tools. On Windows 10 version 2004 or later, the overlay is fully invisible to screen shares and recording tools. On older versions, it may appear as a black rectangle.'
  },
  {
    icon: '6',
    title: 'Shortcut Reference',
    body: 'Trigger Sidecar from anywhere using your keyboard. All of these are remappable in Settings > Screen.',
    shortcuts: [
      { keys: [modKey, 'Enter'], action: 'Trigger Assist' },
      { keys: [modKey, 'H'], action: 'Solve screen contents' },
      { keys: [modKey, 'G'], action: 'Start listening and assist' },
      { keys: [modKey, 'Shift', 'H'], action: 'Hide or show the overlay' },
      { keys: [modKey, 'Shift', 'X'], action: 'Quit application' }
    ]
  }
];

export default function OnboardingGuide({ isOpen, onClose, sidecar }) {
  const [stepIndex, setStepIndex] = useState(0);

  if (!isOpen) return null;

  const currentStep = ONBOARD_STEPS[stepIndex];

  const handleNext = () => {
    if (stepIndex === ONBOARD_STEPS.length - 1) {
      onClose();
    } else {
      setStepIndex(stepIndex + 1);
    }
  };

  const handleBack = () => {
    if (stepIndex > 0) {
      setStepIndex(stepIndex - 1);
    }
  };

  const handleOpenSettingsPane = (paneUrl) => {
    sidecar.openUrl(paneUrl);
  };

  /**
   * Render the modifier key symbol.
   * On macOS: 'Cmd' → '⌘', 'Enter' → '↵'
   * On Windows: 'Ctrl' → 'Ctrl', 'Enter' → '↵'
   */
  const renderKeyLabel = (key) => {
    if (key === 'Cmd') return modSymbol;
    if (key === 'Ctrl') return 'Ctrl';
    if (key === 'Enter') return '↵';
    return key;
  };

  return (
    <div className="modal-scrim">
      <div className="onboard-modal modal-glass animate-pop">
        <div className="onboard-dots">
          {ONBOARD_STEPS.map((_, idx) => (
            <span key={idx} className={`dot ${idx === stepIndex ? 'active' : ''}`}></span>
          ))}
        </div>
        
        <div className="onboard-content">
          <div className="onboard-icon">{currentStep.icon}</div>
          <h2 className="onboard-title">{currentStep.title}</h2>
          
          {currentStep.shortcuts ? (
            <div className="onboard-shortcuts-container">
              <p className="onboard-body-title">{currentStep.body}</p>
              <div className="onboard-shortcuts-list">
                {currentStep.shortcuts.map((sh, idx) => (
                  <div key={idx} className="onboard-shortcut-row">
                    <div className="shortcut-chips">
                      {sh.keys.map((k, kidx) => (
                        <React.Fragment key={kidx}>
                          <kbd className="shortcut-key-chip">{renderKeyLabel(k)}</kbd>
                          {kidx < sh.keys.length - 1 && <span className="shortcut-plus">+</span>}
                        </React.Fragment>
                      ))}
                    </div>
                    <span className="shortcut-description">{sh.action}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="onboard-body">{currentStep.body}</p>
          )}

          {currentStep.buttons && (
            <div className="onboard-actions-list">
              {currentStep.buttons.map((btn, idx) => (
                <button 
                  key={idx} 
                  className="onboard-btn-secondary"
                  onClick={() => handleOpenSettingsPane(btn.action)}
                >
                  {btn.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="onboard-footer">
          <button className="btn-skip" onClick={onClose}>Skip</button>
          <div className="spacer"></div>
          {stepIndex > 0 && <button className="btn-back" onClick={handleBack}>Back</button>}
          <button className="btn-next" onClick={handleNext}>
            {stepIndex === ONBOARD_STEPS.length - 1 ? 'Get Started' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
