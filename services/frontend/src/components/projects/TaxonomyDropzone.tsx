/**
 * Picks one taxonomy mapping CSV (SpeciesNet label list). Controlled: the
 * parent owns the file, so the create dialog sends it with the new project
 * and project settings uploads it on save.
 */
import React, { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { FileSpreadsheet, X } from 'lucide-react';

interface TaxonomyDropzoneProps {
  file: File | null;
  onFileChange: (file: File | null) => void;
  disabled?: boolean;
}

export const TaxonomyDropzone: React.FC<TaxonomyDropzoneProps> = ({ file, onFileChange, disabled = false }) => {
  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0) onFileChange(acceptedFiles[0]);
    },
    [onFileChange],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'text/csv': ['.csv'] },
    multiple: false,
    disabled,
  });

  return (
    <div
      {...getRootProps()}
      className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
      } ${
        isDragActive
          ? 'border-primary bg-primary/5'
          : file
            ? 'border-primary/50 bg-accent/30'
            : 'border-border hover:border-primary/50 hover:bg-accent/50'
      }`}
    >
      <input {...getInputProps()} />
      <div className="flex flex-col items-center space-y-2">
        <FileSpreadsheet className="h-6 w-6 text-muted-foreground" />
        <p className="text-sm font-medium">
          {isDragActive ? (
            'Drop CSV here'
          ) : file ? (
            <span className="inline-flex items-center gap-1">
              {file.name}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onFileChange(null); }}
                className="p-0.5 hover:bg-accent rounded"
                title="Remove file"
              >
                <X className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </span>
          ) : (
            'Drop CSV here, or click to select'
          )}
        </p>
      </div>
    </div>
  );
};
