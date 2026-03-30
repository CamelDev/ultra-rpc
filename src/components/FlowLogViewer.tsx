import React, { useEffect, useRef } from 'react';
import { Terminal, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import './FlowLogViewer.css';

interface FlowLog {
  timestamp: number;
  level: string;
  message: string;
}

interface FlowLogViewerProps {
  logs: FlowLog[];
  onClear: () => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
}

const FlowLogViewer: React.FC<FlowLogViewerProps> = ({ logs, onClear, isExpanded, onToggleExpand }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current && isExpanded) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, isExpanded]);

  const formatTime = (ts: number) => {
    return new Date(ts).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });
  };

  if (!isExpanded) {
    return (
      <div className="flow-log-viewer-collapsed" onClick={onToggleExpand}>
        <div className="log-header-left">
          <Terminal size={14} />
          <span>Execution Logs ({logs.length})</span>
        </div>
        <ChevronUp size={14} />
      </div>
    );
  }

  return (
    <div className="flow-log-viewer glass">
      <div className="log-header">
        <div className="log-header-left" onClick={onToggleExpand}>
          <Terminal size={14} />
          <span>Execution Logs ({logs.length})</span>
          <ChevronDown size={14} />
        </div>
        <div className="log-header-actions">
          <button className="icon-btn small" onClick={onClear} title="Clear Logs">
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      <div className="log-content" ref={scrollRef}>
        {logs.length === 0 ? (
          <div className="log-empty">No execution logs yet...</div>
        ) : (
          logs.map((log, i) => (
            <div key={i} className={`log-entry ${log.level}`}>
              <span className="log-time">[{formatTime(log.timestamp)}]</span>
              <span className={`log-level-badge ${log.level}`}>{log.level.toUpperCase()}</span>
              <span className="log-message">{log.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default FlowLogViewer;
