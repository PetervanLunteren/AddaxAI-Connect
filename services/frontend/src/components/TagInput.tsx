/**
 * Tag input with autocomplete suggestions
 *
 * Renders existing tags as removable pills with a text input for adding new tags.
 * Supports autocomplete from existing project tags.
 */
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { X } from 'lucide-react';

interface TagInputProps {
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions: string[];
  disabled?: boolean;
  placeholder?: string;
}

const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 50;

export const TagInput: React.FC<TagInputProps> = ({
  value,
  onChange,
  suggestions,
  disabled = false,
  placeholder = 'Add tag...',
}) => {
  const [inputValue, setInputValue] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close suggestions on click outside
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, []);

  const filteredSuggestions = useMemo(() => {
    if (!inputValue.trim()) return [];
    const search = inputValue.trim().toLowerCase();
    return suggestions.filter(
      (s) => s.includes(search) && !value.includes(s)
    );
  }, [inputValue, suggestions, value]);

  const addTag = (tag: string) => {
    const normalized = tag.trim().toLowerCase().replace(/,/g, '');
    if (!normalized || normalized.length > MAX_TAG_LENGTH) return;
    if (value.includes(normalized)) return;
    if (value.length >= MAX_TAGS) return;
    onChange([...value, normalized]);
    setInputValue('');
    setShowSuggestions(false);
  };

  const removeTag = (tag: string) => {
    onChange(value.filter((t) => t !== tag));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (inputValue.trim()) {
        addTag(inputValue);
      }
    } else if (e.key === 'Backspace' && !inputValue && value.length > 0) {
      removeTag(value[value.length - 1]);
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <div
        className={`flex flex-wrap gap-1.5 min-h-[2.5rem] px-3 py-1.5 border rounded-md bg-background ${
          disabled ? 'bg-muted cursor-not-allowed' : 'cursor-text'
        }`}
        onClick={() => !disabled && inputRef.current?.focus()}
      >
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-accent text-accent-foreground"
          >
            {tag}
            {!disabled && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removeTag(tag);
                }}
                className="hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </span>
        ))}
        {!disabled && value.length < MAX_TAGS && (
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
            onKeyDown={handleKeyDown}
            placeholder={value.length === 0 ? placeholder : ''}
            className="flex-1 min-w-[80px] text-sm bg-transparent outline-none placeholder:text-muted-foreground"
            disabled={disabled}
          />
        )}
      </div>

      {/* Autocomplete suggestions */}
      {showSuggestions && filteredSuggestions.length > 0 && (
        <div className="absolute left-0 right-0 mt-1 border rounded-md bg-background shadow-lg z-50 max-h-40 overflow-y-auto">
          {filteredSuggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => addTag(suggestion)}
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
