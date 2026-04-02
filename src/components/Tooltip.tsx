import React, { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import './Tooltip.css';

interface TooltipProps {
  text: string | React.ReactNode;
  children: React.ReactElement;
  position?: 'top' | 'bottom' | 'left' | 'right';
  delay?: number;
}

const Tooltip: React.FC<TooltipProps> = ({ 
  text, 
  children, 
  position = 'top',
  delay = 200 
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [coords, setCoords] = useState({ top: -1000, left: -1000 });
  const targetRef = useRef<HTMLElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updatePosition = useCallback(() => {
    if (targetRef.current) {
      let rect = targetRef.current.getBoundingClientRect();
      
      // Handle display: contents or other zeroed rect cases
      if ((rect.width === 0 || rect.height === 0) && targetRef.current.children.length > 0) {
        rect = targetRef.current.children[0].getBoundingClientRect();
      }

      // If still zero (e.g. element not mounted or truly empty), don't position yet
      if (rect.width === 0 && rect.height === 0) return;

      // Use window.scroll properties robustly
      const scrollLeft = window.scrollX || document.documentElement.scrollLeft;
      const scrollTop = window.scrollY || document.documentElement.scrollTop;

      let top = 0;
      let left = 0;

      switch (position) {
        case 'top':
          top = rect.top + scrollTop - 8;
          left = rect.left + scrollLeft + rect.width / 2;
          break;
        case 'bottom':
          top = rect.bottom + scrollTop + 8;
          left = rect.left + scrollLeft + rect.width / 2;
          break;
        case 'left':
          top = rect.top + scrollTop + rect.height / 2;
          left = rect.left + scrollLeft - 8;
          break;
        case 'right':
          top = rect.top + scrollTop + rect.height / 2;
          left = rect.right + scrollLeft + 8;
          break;
      }

      setCoords({ top, left });
    }
  }, [position]);

  useLayoutEffect(() => {
    if (isVisible) {
      updatePosition();
    }
  }, [isVisible, updatePosition]);

  const handleMouseEnter = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setIsVisible(true);
    }, delay);
  };

  const handleMouseLeave = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setIsVisible(false);
    setCoords({ top: -1000, left: -1000 });
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (isVisible) {
      window.addEventListener('scroll', updatePosition, true);
      window.addEventListener('resize', updatePosition);
      return () => {
        window.removeEventListener('scroll', updatePosition, true);
        window.removeEventListener('resize', updatePosition);
      };
    }
  }, [isVisible, updatePosition]);

  return (
    <>
      <span 
        ref={targetRef as any}
        className="tooltip-trigger"
        style={{ display: 'inline-flex', verticalAlign: 'middle' }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {React.cloneElement(children as any, {
          'data-tooltip': typeof text === 'string' ? text : undefined,
          title: typeof text === 'string' ? text : undefined,
        })}
      </span>
      {isVisible && createPortal(
        <div 
          className={`tooltip-portal tooltip-${position} fade-in-fast`}
          style={{ 
            top: coords.top, 
            left: coords.left,
            visibility: coords.top === -1000 ? 'hidden' : 'visible'
          }}
        >
          {text}
        </div>,
        document.body
      )}
    </>
  );
};

export default Tooltip;
