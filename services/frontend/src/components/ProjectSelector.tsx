/**
 * Project selector dropdown component
 *
 * Shows current project and allows switching between projects
 */
import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { cn } from '../lib/utils';

export const ProjectSelector: React.FC = () => {
  const { selectedProject, projects, selectProject, loading } = useProject();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (loading || !projects || projects.length === 0) {
    return null;
  }

  // If only one project, show it without dropdown
  if (projects.length === 1) {
    return (
      <div className="px-2 py-1.5 text-xs text-muted-foreground">
        {selectedProject?.name || projects[0].name}
      </div>
    );
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'flex items-center justify-between w-full px-2 py-1.5 text-sm',
          'rounded-md hover:bg-accent transition-colors',
          'text-left'
        )}
      >
        <span className="truncate">{selectedProject?.name || 'Select Project'}</span>
        <ChevronDown className={cn(
          'h-4 w-4 ml-2 flex-shrink-0 transition-transform',
          isOpen && 'rotate-180'
        )} />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-1 py-1 bg-card border border-border rounded-md shadow-lg z-50">
          {projects.map((project) => (
            <button
              key={project.id}
              onClick={() => {
                selectProject(project);
                setIsOpen(false);
              }}
              className={cn(
                'flex items-center justify-between w-full px-3 py-2 text-sm',
                'hover:bg-accent transition-colors',
                selectedProject?.id === project.id && 'bg-accent'
              )}
            >
              <span className="truncate">{project.name}</span>
              {selectedProject?.id === project.id && (
                <Check className="h-4 w-4 ml-2 flex-shrink-0 text-primary" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
