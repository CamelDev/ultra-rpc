import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { 
  Search, 
  X, 
  Folder, 
  Zap, 
  ChevronRight, 
  ChevronDown,
  Database,
  ArrowRight
} from 'lucide-react';
import { Tree, type NodeRendererProps } from 'react-arborist';
import { motion } from 'framer-motion';
import type { Collection, CollectionItem } from '../types';
import './RequestSelectorModal.css';

interface RequestSelectorModalProps {
  collections: Collection[];
  onClose: () => void;
  onSelect: (requestId: string, collectionId: string) => void;
  currentRequestId?: string;
}

type TreeDataItem = {
  id: string;
  realId: string;
  name: string;
  type: 'folder' | 'request' | 'flow';
  children?: TreeDataItem[];
  method?: string;
  requestType?: 'REST' | 'GRPC';
};

const methodColor = (m: string) => {
  switch (m) {
    case 'GET': return '#22c55e';
    case 'POST': return '#f59e0b';
    case 'PUT': return '#3b82f6';
    case 'DELETE': return '#ef4444';
    case 'PATCH': return '#8b5cf6';
    case 'GRPC': return '#a855f7';
    default: return '#a855f7';
  }
};

export const RequestSelectorModal: React.FC<RequestSelectorModalProps> = ({
  collections,
  onClose,
  onSelect,
  currentRequestId
}) => {
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Find initial collection
  useEffect(() => {
    if (currentRequestId) {
      const findColId = (items: CollectionItem[], colId: string): boolean => {
        for (const item of items) {
          if (item.id === currentRequestId) return true;
          if (item.children && findColId(item.children, colId)) return true;
        }
        return false;
      };

      for (const col of collections) {
        if (findColId(col.children || [], col.id)) {
          setSelectedCollectionId(col.id);
          return;
        }
      }
    }
    
    if (collections.length > 0 && !selectedCollectionId) {
      setSelectedCollectionId(collections[0].id);
    }
  }, [collections, currentRequestId]);

  const selectedCollection = useMemo(() => 
    collections.find(c => c.id === selectedCollectionId), 
    [collections, selectedCollectionId]
  );

  const treeData = useMemo<TreeDataItem[]>(() => {
    if (!selectedCollection) return [];

    const transform = (item: CollectionItem): TreeDataItem => ({
      id: item.id,
      realId: item.id,
      name: item.name,
      type: item.type,
      method: item.request?.type === 'GRPC' ? 'GRPC' : item.request?.method,
      requestType: item.request?.type,
      children: item.children ? item.children.map(transform) : undefined,
    });

    return (selectedCollection.children || []).map(transform);
  }, [selectedCollection]);

  const NodeRenderer = ({ node, style, dragHandle }: NodeRendererProps<TreeDataItem>) => {
    const isFolder = node.data.type === 'folder';
    const isRequest = node.data.type === 'request';
    const method = node.data.method;

    return (
      <div 
        ref={dragHandle as any}
        style={style} 
        className={`tree-node ${node.isSelected ? 'selected' : ''}`}
        onClick={() => {
          if (isRequest) {
            onSelect(node.data.realId, selectedCollectionId!);
            onClose();
          } else {
            node.toggle();
          }
        }}
      >
        <div className="tree-node-content" style={{ paddingLeft: node.level * 12 }}>
          {isFolder && (
            <div className="tree-node-chevron">
              {node.isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </div>
          )}
          {!isFolder && <div style={{ width: 14 }} />}

          <div className="tree-node-icon">
            {isFolder ? <Folder size={16} /> : <Zap size={16} />}
          </div>

          {isRequest && method && (
            <span className="coll-req-method-label" style={{
              color: methodColor(method),
              borderColor: methodColor(method) + '44'
            }}>
              {method === 'GRPC' ? 'gRPC' : method}
            </span>
          )}

          <span className="tree-node-name">{node.data.name}</span>
          
          {isRequest && node.isSelected && (
            <ArrowRight size={14} style={{ marginLeft: 'auto', opacity: 0.8 }} />
          )}
        </div>
      </div>
    );
  };

  return createPortal(
    <div className="request-selector-overlay" onClick={onClose}>
      <motion.div 
        className="request-selector-content glass"
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        onClick={e => e.stopPropagation()}
      >
        <div className="request-selector-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Database size={18} className="collection-nav-icon" />
            <h3>Select Request</h3>
          </div>
          <button className="btn-ghost" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="request-selector-body">
          {/* Sidebar */}
          <div className="request-selector-sidebar">
            <div className="sidebar-category-label">Collections</div>
            {collections.map(c => (
              <div 
                key={c.id} 
                className={`collection-nav-item ${selectedCollectionId === c.id ? 'active' : ''}`}
                onClick={() => setSelectedCollectionId(c.id)}
              >
                <Folder size={16} className="collection-nav-icon" />
                <span className="coll-name">{c.name}</span>
              </div>
            ))}
            {collections.length === 0 && (
              <div className="empty-state" style={{ padding: '20px', fontSize: '11px' }}>
                No collections found
              </div>
            )}
          </div>

          {/* Main Area */}
          <div className="request-selector-main">
            <div className="request-search-container">
              <div className="search-input-wrapper">
                <Search size={14} className="search-icon" />
                <input 
                  ref={searchInputRef}
                  type="text" 
                  placeholder="Search requests by name..." 
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  autoFocus
                />
                {searchTerm && (
                  <button 
                    className="btn-ghost" 
                    onClick={() => setSearchTerm('')}
                    style={{ position: 'absolute', right: '8px', padding: '4px' }}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>

            <div className="request-tree-area">
              {selectedCollection ? (
                <Tree
                  data={treeData}
                  searchTerm={searchTerm}
                  searchMatch={(node, term) => 
                    node.data.name.toLowerCase().includes(term.toLowerCase())
                  }
                  width="100%"
                  height={500}
                  indent={0}
                  rowHeight={34}
                  openByDefault={searchTerm.length > 0}
                >
                  {NodeRenderer}
                </Tree>
              ) : (
                <div className="empty-state">
                  <Database size={40} />
                  <p>Select a collection to browse requests</p>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="request-selector-footer">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </motion.div>
    </div>,
    document.body
  );
};
