/**
 * Tag input with autocomplete suggestions.
 *
 * Renders existing tags as removable pills with a text input for adding new
 * tags. The suggestion list opens on focus with every existing tag, so the
 * vocabulary is visible before anything is typed and spelling variants stop
 * being created by accident. Nothing is highlighted until the user types or
 * presses an arrow key, so focusing the field and pressing Enter adds nothing.
 *
 * A host can also make the widget the tag editor by passing `management`:
 * each suggestion then carries a count, a rename pencil and a delete trash,
 * and the row's own tags are listed too (muted, not addable), so a typo can
 * be fixed on the row where it is seen. Those actions change the tag
 * everywhere in the project, not just on the row being edited, so hosts pass
 * them only in admin contexts and confirm deletes themselves (the widget just
 * reports the wish). The icons render always, not on hover, because hover
 * does not exist on phones.
 *
 * The list sits in the normal page flow rather than floating over it, so a
 * dialog or sheet with its own scroll area cannot clip it or hide buttons.
 */
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Check, Pencil, Trash2, X } from 'lucide-react';

export interface TagManagement {
  /** Rename the tag across the whole project (merge when the name exists). */
  onRenameTag: (oldTag: string, newTag: string) => void;
  /** Delete the tag across the whole project. The host confirms first. */
  onDeleteTag: (tag: string) => void;
  /** Rows carrying each tag, shown next to the suggestion. */
  counts: Record<string, number>;
  /** What a row is called, e.g. "site", so the count reads "on 3 sites". */
  noun: string;
}

interface TagInputProps {
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions: string[];
  disabled?: boolean;
  placeholder?: string;
  management?: TagManagement;
}

const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 50;

const normalize = (tag: string) =>
  tag.trim().toLowerCase().replace(/,/g, '');

export const TagInput: React.FC<TagInputProps> = ({
  value,
  onChange,
  suggestions,
  disabled = false,
  placeholder = 'Add tag...',
  management,
}) => {
  const [inputValue, setInputValue] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  // Highlighted suggestion, -1 for none. Typing preselects the first match
  // that can be added; arrows move through the list; Enter picks the
  // highlight.
  const [activeIndex, setActiveIndex] = useState(-1);
  // The suggestion currently being renamed, and the draft name.
  const [renamingTag, setRenamingTag] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const typed = inputValue.trim() !== '';
  const onRow = (tag: string) => value.includes(tag);

  // Close suggestions on click outside
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
        setRenamingTag(null);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, []);

  // With nothing typed the whole vocabulary shows, typing narrows it. The
  // row's own tags only show when the host manages tags, to rename them.
  const filteredSuggestions = useMemo(() => {
    const search = inputValue.trim().toLowerCase();
    return suggestions.filter(
      (s) => (!search || s.includes(search)) && (!!management || !value.includes(s)),
    );
  }, [inputValue, suggestions, value, management]);

  useEffect(() => {
    setActiveIndex(typed ? filteredSuggestions.findIndex((s) => !value.includes(s)) : -1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredSuggestions]);

  const addTag = (tag: string) => {
    const normalized = normalize(tag);
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

  const startRename = (tag: string) => {
    setRenamingTag(tag);
    setRenameValue(tag);
  };

  const commitRename = () => {
    const normalized = normalize(renameValue);
    if (renamingTag && normalized && normalized !== renamingTag) {
      management?.onRenameTag(renamingTag, normalized);
    }
    setRenamingTag(null);
  };

  const suggestionsOpen = showSuggestions && filteredSuggestions.length > 0;
  const highlighted = activeIndex >= 0 ? filteredSuggestions[activeIndex] : undefined;

  // Adds the highlighted suggestion when there is one the row lacks, else
  // the typed text. Blur commits too, because a parent form reads only
  // `value`: text left in the box when the user clicked Save used to be
  // thrown away. Escape first to type a tag that is a prefix of another.
  const commitInput = () => {
    if (suggestionsOpen && highlighted && !onRow(highlighted)) {
      addTag(highlighted);
    } else if (typed) {
      addTag(inputValue);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const n = filteredSuggestions.length;
    if (e.key === 'Enter') {
      e.preventDefault();
      commitInput();
    } else if (e.key === 'ArrowDown' && suggestionsOpen) {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % n);
    } else if (e.key === 'ArrowUp' && suggestionsOpen) {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? n - 1 : i - 1));
    } else if (e.key === 'Backspace' && !inputValue && value.length > 0) {
      removeTag(value[value.length - 1]);
    } else if (e.key === 'Escape' && suggestionsOpen) {
      // The open list is the top layer: Escape closes it, not the dialog
      // or sheet around the field.
      e.stopPropagation();
      setShowSuggestions(false);
    }
  };

  return (
    <div ref={containerRef}>
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
            maxLength={MAX_TAG_LENGTH}
            onChange={(e) => {
              setInputValue(e.target.value);
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={(e) => {
              // Focus moving inside the widget (to the rename field) is not
              // leaving it, so the typed filter must not be added as a tag.
              // Leaving only commits typed text, never a bare highlight.
              if (containerRef.current?.contains(e.relatedTarget as Node)) return;
              if (typed) commitInput();
            }}
            onKeyDown={handleKeyDown}
            placeholder={value.length === 0 ? placeholder : ''}
            className="flex-1 min-w-[80px] text-sm bg-transparent outline-none placeholder:text-muted-foreground"
            disabled={disabled}
          />
        )}
      </div>

      {/* Autocomplete suggestions */}
      {suggestionsOpen && (
        <div className="mt-1 border rounded-md bg-background max-h-48 overflow-y-auto">
          {filteredSuggestions.map((suggestion, index) =>
            renamingTag === suggestion && management ? (
              <div key={suggestion} className="flex items-center gap-1 px-3 py-1">
                <input
                  autoFocus
                  type="text"
                  value={renameValue}
                  maxLength={MAX_TAG_LENGTH}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commitRename();
                    } else if (e.key === 'Escape') {
                      e.stopPropagation();
                      setRenamingTag(null);
                    }
                  }}
                  className="flex-1 min-w-0 text-sm border rounded px-2 py-0.5 bg-background"
                />
                <button
                  type="button"
                  title="Rename everywhere"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={commitRename}
                  className="p-1 text-muted-foreground hover:text-foreground"
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <div
                key={suggestion}
                className={`flex items-center ${index === activeIndex ? 'bg-accent' : ''}`}
                // Move, not enter: mouseenter also fires when the list opens
                // under a resting cursor, which would highlight a row the
                // user never pointed at and let Enter add it.
                onMouseMove={() => {
                  if (index !== activeIndex) setActiveIndex(index);
                }}
              >
                <button
                  type="button"
                  // Keep focus in the input, or the blur above would add the
                  // typed prefix as a tag before this click adds the suggestion
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => addTag(suggestion)}
                  disabled={onRow(suggestion)}
                  title={onRow(suggestion) ? `Already on this ${management?.noun ?? 'item'}` : undefined}
                  className="flex-1 min-w-0 text-left px-3 py-1.5 text-sm truncate hover:bg-accent disabled:cursor-default disabled:text-muted-foreground disabled:hover:bg-transparent"
                >
                  {suggestion}
                </button>
                {management && (
                  <>
                    <span className="text-xs text-muted-foreground tabular-nums shrink-0 whitespace-nowrap">
                      on {management.counts[suggestion] ?? 0} {management.noun}
                      {(management.counts[suggestion] ?? 0) === 1 ? '' : 's'}
                    </span>
                    <button
                      type="button"
                      title={`Rename "${suggestion}" everywhere`}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={(e) => {
                        e.stopPropagation();
                        startRename(suggestion);
                      }}
                      className="p-1.5 text-muted-foreground hover:text-foreground shrink-0"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      title={`Delete "${suggestion}" everywhere`}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowSuggestions(false);
                        management.onDeleteTag(suggestion);
                      }}
                      className="p-1.5 pr-2.5 text-muted-foreground hover:text-destructive shrink-0"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
};
