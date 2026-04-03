import React from 'react';
import { createPortal } from 'react-dom';
import { X, Search, Info } from 'lucide-react';
import Editor from './Editor';
import './JsonResponsePickerModal.css';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  jsonData: any;
  onSelectPath: (path: string) => void;
}

export const JsonResponsePickerModal: React.FC<Props> = ({ 
  isOpen, 
  onClose, 
  title, 
  jsonData, 
  onSelectPath 
}) => {
  const jsonString = React.useMemo(() => {
    if (typeof jsonData === 'string') {
        try {
            // Check if it's already a JSON string, if so, format it
            return JSON.stringify(JSON.parse(jsonData), null, 2);
        } catch {
            return jsonData;
        }
    }
    return JSON.stringify(jsonData, null, 2);
  }, [jsonData]);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div className="picker-modal-overlay" onClick={onClose}>
      <div className="picker-modal" onClick={e => e.stopPropagation()}>
        <div className="picker-modal-header">
          <div className="picker-modal-title">
            <Search size={16} />
            <h3>Pick JSON Path from: {title}</h3>
          </div>
          <button className="picker-modal-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        
        <div className="picker-modal-info">
          <Info size={14} />
          <span>Select Mode Active: Click any field to extract its JSONPath.</span>
        </div>

        <div className="picker-modal-body">
          <Editor 
            value={jsonString}
            language="json"
            readOnly={true}
            onSelectPath={(path) => {
              onSelectPath(path);
              onClose();
            }}
            enableSearch={true}
          />
        </div>
        
        <div className="picker-modal-footer">
          <button className="btn-cancel" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body
  );
};
