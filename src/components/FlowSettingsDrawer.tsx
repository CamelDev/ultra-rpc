import React, { useState, useEffect } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import type { FlowDefinition } from '../types/flow';
import type { KeyValuePair } from '../types';
import KeyValueEditor from './KeyValueEditor';
import { kvToRecord, recordToKV } from '../lib/helpers';
import './FlowSettingsDrawer.css';

interface FlowSettingsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  flow: FlowDefinition;
  onUpdate: (updates: Partial<FlowDefinition>) => void;
  environments: any[];
}

const FlowSettingsDrawer: React.FC<FlowSettingsDrawerProps> = ({
  isOpen,
  onClose,
  flow,
  onUpdate,
  environments
}) => {
  if (!isOpen) return null;

  const settings = flow.settings || { timeoutMs: 30000, onFailure: 'stop', repeat: 1 };
  
  // Local state for variables to allow empty rows while editing
  const [localVars, setLocalVars] = useState(recordToKV(flow.variables || {}));

  useEffect(() => {
    if (isOpen) {
      setLocalVars(recordToKV(flow.variables || {}));
    }
  }, [isOpen]);

  const handleVarsChange = (newKV: KeyValuePair[]) => {
    setLocalVars(newKV);
    onUpdate({ variables: kvToRecord(newKV) });
  };

  return (
    <div className="flow-settings-overlay" onClick={onClose}>
      <div className="flow-settings-drawer glass fade-in-right" onClick={e => e.stopPropagation()}>
        <div className="drawer-header">
          <div className="drawer-title">
            <span>Flow Settings</span>
          </div>
          <button className="icon-btn" onClick={onClose} data-tooltip="Close" data-tooltip-pos="left">
            <X size={20} />
          </button>
        </div>

        <div className="drawer-content">
          <div className="settings-section">
            <h3>Execution Behavior</h3>
            <div className="settings-field">
              <label>Environment</label>
              <select
                value={settings.environmentId || ''}
                onChange={e => onUpdate({ 
                  settings: { ...settings, environmentId: e.target.value || null } 
                })}
              >
                <option value="">None</option>
                {environments.map(env => (
                  <option key={env.id} value={env.id}>{env.name}</option>
                ))}
              </select>
              <div className="field-hint">
                <AlertTriangle size={12} />
                <span>The default environment for all request steps in this flow.</span>
              </div>
            </div>

            <div className="settings-field">
              <label>On Failure</label>
              <select
                value={settings.onFailure}
                onChange={e => onUpdate({ 
                  settings: { ...settings, onFailure: e.target.value as any } 
                })}
              >
                <option value="stop">Stop (default)</option>
                <option value="continue">Continue to next step</option>
                <option value="retry">Retry current step</option>
              </select>
              <div className="field-hint">
                <AlertTriangle size={12} />
                <span>Determines if the flow stops when a request or assertion fails.</span>
              </div>
            </div>

            {settings.onFailure === 'retry' && (
              <div className="settings-field fade-in-up">
                <label>Max Step Retries</label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={settings.retryCount || 3}
                  onChange={e => onUpdate({ 
                    settings: { ...settings, retryCount: parseInt(e.target.value) || 1 } 
                  })}
                />
              </div>
            )}

            <div className="settings-field">
              <label>Global Timeout (ms)</label>
              <input
                type="number"
                placeholder="30000 (Default)"
                value={settings.timeoutMs}
                onChange={e => onUpdate({ 
                  settings: { ...settings, timeoutMs: parseInt(e.target.value) || 30000 } 
                })}
              />
            </div>
          </div>

          <div className="settings-section">
            <h3>Variable Store</h3>
            <p className="section-hint">Current state of variables available to and updated by steps during execution.</p>
            <KeyValueEditor
              pairs={localVars}
              onChange={handleVarsChange}
              keyPlaceholder="Variable Name"
              valuePlaceholder="Current Value"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default FlowSettingsDrawer;
