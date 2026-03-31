import React, { useState, useRef, useEffect } from 'react';
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
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const targetRef = useRef<HTMLElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updatePosition = () => {
    if (targetRef.current) {
      const rect = targetRef.current.getBoundingClientRect();
      const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
      const scrollTop = window.pageYOffset || document.documentElement.scrollTop;

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
  };

  const handleMouseEnter = () => {
    timeoutRef.current = setTimeout(() => {
      updatePosition();
      setIsVisible(true);
    }, delay);
  };

  const handleMouseLeave = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setIsVisible(false);
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return (
    <>
      <span 
        ref={targetRef as any}
        className="tooltip-trigger"
        style={{ display: 'contents' }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {React.cloneElement(children, {
          'data-tooltip': typeof text === 'string' ? text : undefined,
          title: typeof text === 'string' ? text : undefined,
        } as any)}
      </span>
      {isVisible && createPortal(
        <div 
          className={`tooltip-portal tooltip-${position} fade-in-fast`}
          style={{ top: coords.top, left: coords.left }}
        >
          {text}
        </div>,
        document.body
      )}
    </>
  );
};

export default Tooltip;
