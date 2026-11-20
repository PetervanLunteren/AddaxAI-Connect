/**
 * Add many sites at once from a CSV file: Name, Latitude, Longitude, and
 * Notes if wanted. Good rows are added, each bad row comes back with its
 * reason. The same flow as the camera import on the Cameras page.
 */
import React, { useCallback, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useDropzone } from 'react-dropzone';
import { CheckCircle, Loader2, Upload, XCircle } from 'lucide-react';
import { sitesApi, type SiteImportResponse } from '../../api/sites';
import { Button } from '../ui/Button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/Dialog';
import { useToast } from '../ui/Toaster';

export const SiteImportDialog: React.FC<{ projectId: number; onClose: () => void }> = ({ projectId, onClose }) => {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [results, setResults] = useState<SiteImportResponse | null>(null);

  const onDrop = useCallback((accepted: File[]) => {
    if (accepted.length > 0) setFile(accepted[0]);
  }, []);
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'text/csv': ['.csv'] },
    multiple: false,
  });

  const upload = useMutation({
    mutationFn: () => sitesApi.importCsv(projectId, file!),
    onSuccess: (data) => {
      setResults(data);
      queryClient.invalidateQueries({ queryKey: ['sites', projectId] });
    },
    onError: (error: any) => toast.error(`Could not import the file. ${error.response?.data?.detail || error.message || ''}`),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent onClose={onClose} className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import sites from CSV</DialogTitle>
          <DialogDescription>Add the sites of your project in one go, before any camera sends a photo.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-1 pb-4">
          {!results ? (
            <>
              <div className="bg-accent/50 p-4 rounded-md grid sm:grid-cols-[1fr,1.2fr] gap-x-4 gap-y-2 items-start">
                <div>
                  <p className="text-sm font-medium">A name and a location per site</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Latitude and longitude in decimal degrees, with a point as decimal sign. A{' '}
                    <code className="bg-background px-1 rounded">Notes</code> column is optional.
                  </p>
                </div>
                <pre className="text-[11px] leading-relaxed bg-background p-2 rounded overflow-x-auto">
{`Name,Latitude,Longitude,Notes
Pond,52.0800,5.8300,
Ridge,52.0935,5.8300,On the old dike`}
                </pre>
              </div>
              <div
                {...getRootProps()}
                className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                  isDragActive ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-accent/50'
                }`}
              >
                <input {...getInputProps()} />
                {file ? (
                  <div className="flex items-center justify-center gap-2">
                    <Upload className="h-5 w-5 text-primary" />
                    <span className="text-sm font-medium">{file.name}</span>
                  </div>
                ) : (
                  <div>
                    <Upload className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">
                      {isDragActive ? 'Drop the CSV file here' : 'Drag and drop a CSV file here, or click to browse'}
                    </p>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-4 p-4 bg-accent/50 rounded-md">
                <div className="flex items-center gap-2 text-green-600">
                  <CheckCircle className="h-5 w-5" />
                  <span className="font-medium">Added {results.success_count}</span>
                </div>
                {results.failed_count > 0 && (
                  <div className="flex items-center gap-2 text-destructive">
                    <XCircle className="h-5 w-5" />
                    <span className="font-medium">Not added {results.failed_count}</span>
                  </div>
                )}
              </div>
              <div className="max-h-96 overflow-auto border rounded-md">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-accent border-b">
                    <tr>
                      <th className="text-left py-2 px-3">Row</th>
                      <th className="text-left py-2 px-3">Name</th>
                      <th className="text-left py-2 px-3">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.results.map((r) => (
                      <tr key={r.row_number} className="border-b">
                        <td className="py-2 px-3">{r.row_number}</td>
                        <td className="py-2 px-3">{r.name}</td>
                        <td className={`py-2 px-3 ${r.success ? 'text-green-600' : 'text-destructive'}`}>
                          {r.success ? 'Added' : r.error}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{results ? 'Close' : 'Cancel'}</Button>
          {!results && (
            <Button onClick={() => upload.mutate()} disabled={!file || upload.isPending}>
              {upload.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
              Import
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
