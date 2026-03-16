/**
 * SpeciesNet configuration page
 *
 * Combined page for SpeciesNet-specific settings: geofencing and taxonomy mapping.
 * Only accessible by server admins on SpeciesNet servers.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useDropzone } from 'react-dropzone';
import {
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,

  FileSpreadsheet,
  ChevronRight,
  ChevronDown,
} from 'lucide-react';
import { Card, CardContent } from '../../components/ui/Card';
import { ServerPageLayout } from '../../components/layout/ServerPageLayout';
import { CountrySelect } from '../../components/ui/CountrySelect';
import { StateSelect } from '../../components/ui/StateSelect';
import { Button } from '../../components/ui/Button';
import { adminApi } from '../../api/admin';

export const SpeciesNetConfigPage: React.FC = () => {
  const queryClient = useQueryClient();

  // --- Geofencing state ---
  const [countryCode, setCountryCode] = useState('');
  const [admin1Region, setAdmin1Region] = useState('');
  const [geoSaveStatus, setGeoSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [geoError, setGeoError] = useState<string | null>(null);

  // --- Taxonomy state ---
  const [showMapping, setShowMapping] = useState(false);
  const [uploadModal, setUploadModal] = useState<{
    open: boolean;
    status: 'uploading' | 'done' | 'error';
    count?: number;
    reprocessedCount?: number;
    error?: string;
  }>({ open: false, status: 'uploading' });
  // Query server settings (for geofencing)
  const { data: serverSettings, isLoading: settingsLoading } = useQuery({
    queryKey: ['server-settings'],
    queryFn: adminApi.getServerSettings,
    retry: false,
  });

  // Sync geofencing state when server settings load
  useEffect(() => {
    if (serverSettings?.speciesnet_country_code) {
      setCountryCode(serverSettings.speciesnet_country_code);
    }
    if (serverSettings?.speciesnet_admin1_region) {
      setAdmin1Region(serverSettings.speciesnet_admin1_region);
    }
  }, [serverSettings]);

  // Geofencing save
  const hasGeoChanges = countryCode !== (serverSettings?.speciesnet_country_code ?? '')
    || admin1Region !== (serverSettings?.speciesnet_admin1_region ?? '');

  const updateGeoMutation = useMutation({
    mutationFn: (data: { speciesnet_country_code: string; speciesnet_admin1_region: string }) =>
      adminApi.updateServerSettings(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['server-settings'] });
      queryClient.invalidateQueries({ queryKey: ['setup-status'] });
      setGeoSaveStatus('success');
      setTimeout(() => setGeoSaveStatus('idle'), 2000);
    },
    onError: (error: any) => {
      setGeoError(error.response?.data?.detail || error.message || 'Failed to save');
      setGeoSaveStatus('error');
      setTimeout(() => setGeoSaveStatus('idle'), 3000);
    },
  });

  const handleSaveGeo = () => {
    if (!countryCode) return;
    setGeoSaveStatus('saving');
    setGeoError(null);
    updateGeoMutation.mutate({
      speciesnet_country_code: countryCode,
      speciesnet_admin1_region: admin1Region,
    });
  };

  // Fetch current taxonomy mapping
  const { data: taxonomyData, isLoading: taxonomyLoading } = useQuery({
    queryKey: ['taxonomy-mapping'],
    queryFn: adminApi.getTaxonomyMapping,
  });

  // Upload mutation with modal
  const uploadMutation = useMutation({
    mutationFn: adminApi.uploadTaxonomyMapping,
    onSuccess: (result) => {
      setUploadModal({
        open: true,
        status: 'done',
        count: result.count,
        reprocessedCount: result.reprocessed_count,
      });
      queryClient.invalidateQueries({ queryKey: ['taxonomy-mapping'] });
      queryClient.invalidateQueries({ queryKey: ['available-species'] });
      queryClient.invalidateQueries({ queryKey: ['setup-status'] });
    },
    onError: (error: any) => {
      setUploadModal({
        open: true,
        status: 'error',
        error: error.response?.data?.detail || error.message || 'Upload failed',
      });
    },
  });

  const handleUpload = useCallback((file: File) => {
    setUploadModal({ open: true, status: 'uploading' });
    uploadMutation.mutate(file);
  }, [uploadMutation]);

  // Dropzone
  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0) {
        handleUpload(acceptedFiles[0]);
      }
    },
    [handleUpload]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'text/csv': ['.csv'] },
    multiple: false,
  });

  const entries = taxonomyData?.entries || [];

  return (
    <ServerPageLayout
      title="SpeciesNet configuration"
      description="Geofencing and taxonomy mapping for SpeciesNet classification"
    >
      <div className="space-y-6">
        {/* Geofencing card */}
        <Card>
          <CardContent className="pt-6">
            {/* Country */}
            <div className="flex items-center gap-8">
              <div className="w-1/2 shrink-0">
                <label className="text-sm font-medium block">Country</label>
                <p className="text-sm text-muted-foreground mt-1">
                  Select the country where cameras are deployed. Filters out species that do not occur in this country. Only applies to new analyses, not retroactively.
                </p>
              </div>
              <div className="flex-1">
                {settingsLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                ) : (
                  <CountrySelect
                    value={countryCode}
                    onChange={(code) => {
                      setCountryCode(code);
                      if (code !== 'USA') setAdmin1Region('');
                    }}
                    disabled={geoSaveStatus === 'saving'}
                  />
                )}
              </div>
            </div>

            {/* State (conditional) */}
            {countryCode === 'USA' && (
              <>
                <div className="border-t my-6" />
                <div className="flex items-center gap-8">
                  <div className="w-1/2 shrink-0">
                    <label className="text-sm font-medium block">State</label>
                    <p className="text-sm text-muted-foreground mt-1">
                      Optionally narrow geofencing to a specific US state.
                    </p>
                  </div>
                  <div className="flex-1">
                    <StateSelect
                      value={admin1Region}
                      onChange={setAdmin1Region}
                      disabled={geoSaveStatus === 'saving'}
                    />
                  </div>
                </div>
              </>
            )}

            {/* Error */}
            {geoError && (
              <>
                <div className="border-t my-6" />
                <div className="p-3 bg-destructive/10 text-destructive text-sm rounded-md flex items-center gap-2">
                  <AlertCircle className="h-4 w-4" />
                  {geoError}
                </div>
              </>
            )}

            {/* Save button */}
            {hasGeoChanges && countryCode && (
              <>
                <div className="border-t my-6" />
                <div className="flex justify-end">
                  <Button
                    onClick={handleSaveGeo}
                    disabled={geoSaveStatus === 'saving'}
                  >
                    {geoSaveStatus === 'saving' ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      'Save geofencing'
                    )}
                  </Button>
                </div>
              </>
            )}

            {geoSaveStatus === 'success' && !hasGeoChanges && (
              <>
                <div className="border-t my-6" />
                <div className="flex justify-end">
                  <p className="text-sm text-green-600">Geofencing settings saved</p>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Taxonomy mapping card */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-start gap-8">
              <div className="w-1/2 shrink-0">
                <label className="text-sm font-medium block">Taxonomy mapping</label>
                <p className="text-sm text-muted-foreground mt-1">
                  Upload a CSV with <code className="text-xs bg-muted px-1 py-0.5 rounded">latin</code> and <code className="text-xs bg-muted px-1 py-0.5 rounded">common</code> columns. You can generate one with Dan Morris's <a href="https://dmorris.net/speciesnet-taxonomy-mapper/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">taxonomy mapper tool</a>. Uploading a new file replaces the existing mapping and automatically reprocesses unverified classifications.
                </p>
                {entries.length > 0 && (
                  <button
                    onClick={() => setShowMapping(!showMapping)}
                    className="flex items-center gap-1 mt-3 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showMapping ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                    View current mapping ({entries.length} labels)
                  </button>
                )}
              </div>
              <div className="flex-1">
                <div
                  {...getRootProps()}
                  className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                    isDragActive
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/50 hover:bg-accent/50'
                  }`}
                >
                  <input {...getInputProps()} />
                  <div className="flex flex-col items-center space-y-2">
                    <FileSpreadsheet className="h-6 w-6 text-muted-foreground" />
                    <p className="text-sm font-medium">
                      {isDragActive ? 'Drop CSV here...' : 'Drop CSV here, or click to select'}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Collapsible mapping table */}
            {showMapping && entries.length > 0 && (
              <div className="mt-4 border rounded-lg overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted">
                      <tr>
                        <th className="text-left px-4 py-2">Latin</th>
                        <th className="text-left px-4 py-2">Common name</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((entry) => (
                        <tr key={entry.id} className="border-t">
                          <td className="px-4 py-2 font-mono text-xs">{entry.latin}</td>
                          <td className="px-4 py-2">{entry.common}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Upload progress modal */}
      {uploadModal.open && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full">
            <div className="p-6">
              {uploadModal.status === 'error' ? (
                <>
                  <div className="flex items-center gap-3 mb-4">
                    <XCircle className="h-5 w-5 text-red-500 shrink-0" />
                    <h3 className="text-lg font-semibold">Upload failed</h3>
                  </div>
                  <p className="text-sm text-muted-foreground mb-6">{uploadModal.error}</p>
                  <div className="flex justify-end">
                    <Button onClick={() => setUploadModal({ open: false, status: 'uploading' })}>
                      Close
                    </Button>
                  </div>
                </>
              ) : uploadModal.status === 'done' ? (
                <>
                  <div className="flex items-center gap-3 mb-4">
                    <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
                    <h3 className="text-lg font-semibold">Upload complete</h3>
                  </div>
                  <p className="text-sm text-muted-foreground mb-1">
                    Uploaded {uploadModal.count} taxonomy entries.
                  </p>
                  {(uploadModal.reprocessedCount ?? 0) > 0 && (
                    <p className="text-sm text-muted-foreground mb-1">
                      {uploadModal.reprocessedCount} classifications reprocessed.
                    </p>
                  )}
                  <div className="flex justify-end mt-6">
                    <Button onClick={() => setUploadModal({ open: false, status: 'uploading' })}>
                      Close
                    </Button>
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-3">
                  <Loader2 className="h-5 w-5 animate-spin text-primary shrink-0" />
                  <h3 className="text-lg font-semibold">Uploading and reprocessing...</h3>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </ServerPageLayout>
  );
};
