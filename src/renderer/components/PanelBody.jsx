import React, { useState, useEffect } from "react";
import MessageBubble from "./MessageBubble";
import TranscriptPane from "./TranscriptPane";

const SPLIT_THRESHOLD_PX = 860;
const modes = [
  { id: "assist", label: "Assist", description: "Contextual screen & conversation assist" },
  { id: "reply", label: "Draft Reply", description: "Suggest spoken reply based on dialogue" },
  { id: "summarize", label: "Summarize", description: "Recap discussions" },
  { id: "questions", label: "Questions", description: "Propose follow-up questions" }
];

export default function PanelBody({
  messages,
  activeMode,
  onSelectMode,
  isListening,
  turns,
  onCopy,
  onOpenOcr
}) {
  const [activeTab, setActiveTab] = useState("answers");
  const [isWideLayout, setIsWideLayout] = useState(() => window.innerWidth >= SPLIT_THRESHOLD_PX);

  useEffect(() => {
    const handleResize = () => setIsWideLayout(window.innerWidth >= SPLIT_THRESHOLD_PX);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const renderAnswersView = () => (
    <div className="messages-viewport">
      {messages.length === 0 ? (
        <div className="empty-viewport-state">
          <p className="primary-empty-text">Sidecar Assistant Active</p>
          <p className="secondary-empty-text">
            {isListening
              ? "Listening to system audio and microphone stream..."
              : "Toggle the status dot above to begin transcription capture."}
          </p>
        </div>
      ) : (
        messages.map((msg, index) => <MessageBubble key={index} message={msg} />)
      )}
    </div>
  );

  const renderTranscriptView = () => <TranscriptPane turns={turns} onCopy={onCopy} />;

  return (
    <div className="panel-body-container no-drag">
      {isWideLayout ? (
        <div className="split-view">
          <div className="split-col">{renderAnswersView()}</div>
          <div className="split-col split-col-transcript">{renderTranscriptView()}</div>
        </div>
      ) : (
        <>
          <div className="panel-tabs">
            <button className={`panel-tab-btn ${activeTab === "answers" ? "active" : ""}`} onClick={() => setActiveTab("answers")}>
              Answers
            </button>
            <button className={`panel-tab-btn ${activeTab === "transcript" ? "active" : ""}`} onClick={() => setActiveTab("transcript")}>
              Transcript{turns.length > 0 ? ` · ${turns.length}` : ""}
            </button>
          </div>
          {activeTab === "answers" ? renderAnswersView() : renderTranscriptView()}
        </>
      )}

      <div className="quick-actions-row">
        {modes.map((mode) => (
          <button
            key={mode.id}
            className={`action-pill-btn ${activeMode === mode.id ? "active" : ""}`}
            onClick={() => onSelectMode(mode.id)}
            title={mode.description}
          >
            {mode.label}
          </button>
        ))}

        <button
          type="button"
          className="action-pill-btn"
          style={{ background: "#e0a45822", borderColor: "#e0a45866", color: "#fff" }}
          onClick={onOpenOcr}
          title="Capture screen & extract OCR text"
        >
          📷 Screen OCR
        </button>
      </div>
    </div>
  );
}
