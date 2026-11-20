/**
 * Dropdown Menu Component
 * Simple dropdown menu for actions.
 *
 * Opens itself on a click by default. Pass `open` and `onOpenChange` to
 * open it from elsewhere too, such as a keyboard shortcut.
 */
import React, { useState, useRef, useEffect } from 'react';

interface DropdownMenuProps {
  children: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string; // on the wrapper, e.g. "block" to fill a grid cell
}

interface DropdownMenuTriggerProps {
  asChild?: boolean;
  children: React.ReactNode;
}

interface DropdownMenuContentProps {
  align?: 'start' | 'end';
  className?: string; // width, "w-48" by default
  children: React.ReactNode;
}

interface DropdownMenuItemProps {
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}

const DropdownMenuContext = React.createContext<{
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
}>({
  isOpen: false,
  setIsOpen: () => {},
});

export const DropdownMenu: React.FC<DropdownMenuProps> = ({ children, open, onOpenChange, className = 'inline-block' }) => {
  const [ownOpen, setOwnOpen] = useState(false);
  const isOpen = open ?? ownOpen;
  const setIsOpen = (next: boolean) => {
    setOwnOpen(next);
    onOpenChange?.(next);
  };

  return (
    <DropdownMenuContext.Provider value={{ isOpen, setIsOpen }}>
      <div className={`relative ${className}`}>{children}</div>
    </DropdownMenuContext.Provider>
  );
};

export const DropdownMenuTrigger: React.FC<DropdownMenuTriggerProps> = ({
  asChild,
  children,
}) => {
  const { isOpen, setIsOpen } = React.useContext(DropdownMenuContext);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsOpen(!isOpen);
  };

  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children as React.ReactElement<any>, {
      onClick: handleClick,
    });
  }

  return <button onClick={handleClick}>{children}</button>;
};

export const DropdownMenuContent: React.FC<DropdownMenuContentProps> = ({
  align = 'start',
  className = 'w-48',
  children,
}) => {
  const { isOpen, setIsOpen } = React.useContext(DropdownMenuContext);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, setIsOpen]);

  if (!isOpen) return null;

  const alignmentClass = align === 'end' ? 'right-0' : 'left-0';

  return (
    <div
      ref={ref}
      className={`absolute ${alignmentClass} mt-2 ${className} rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 z-50`}
    >
      <div className="py-1">{children}</div>
    </div>
  );
};

export const DropdownMenuItem: React.FC<DropdownMenuItemProps> = ({
  onClick,
  disabled = false,
  className = '',
  children,
}) => {
  const { setIsOpen } = React.useContext(DropdownMenuContext);

  const handleClick = () => {
    onClick?.();
    setIsOpen(false);
  };

  return (
    <button
      onClick={handleClick}
      disabled={disabled}
      className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-100 flex items-center disabled:opacity-50 disabled:pointer-events-none ${className}`}
    >
      {children}
    </button>
  );
};
