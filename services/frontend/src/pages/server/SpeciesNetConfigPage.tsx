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
  Trash2,
  FileSpreadsheet,
  Upload,
} from 'lucide-react';
import { TaxonomyUploadEvent } from '../../api/types';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../components/ui/Card';
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
  const [uploadModal, setUploadModal] = useState<{
    open: boolean;
    event: TaxonomyUploadEvent | null;
    error: string | null;
  }>({ open: false, event: null, error: null });
  const [showClearConfirm, setShowClearConfirm] = useState(false);

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

  // Upload with streaming progress
  const handleUpload = useCallback(async (file: File) => {
    setUploadModal({ open: true, event: { stage: 'inserting', count: 0 }, error: null });
    try {
      await adminApi.uploadTaxonomyMapping(file, (event) => {
        setUploadModal((prev) => ({ ...prev, event }));
      });
      queryClient.invalidateQueries({ queryKey: ['taxonomy-mapping'] });
      queryClient.invalidateQueries({ queryKey: ['available-species'] });
      queryClient.invalidateQueries({ queryKey: ['setup-status'] });
    } catch (err: any) {
      const detail = err?.response?.data?.detail || err?.message || 'Upload failed';
      setUploadModal((prev) => ({ ...prev, error: detail, event: null }));
    }
  }, [queryClient]);

  // Clear mutation
  const clearMutation = useMutation({
    mutationFn: adminApi.clearTaxonomyMapping,
    onSuccess: () => {
      setShowClearConfirm(false);
      queryClient.invalidateQueries({ queryKey: ['taxonomy-mapping'] });
      queryClient.invalidateQueries({ queryKey: ['available-species'] });
      queryClient.invalidateQueries({ queryKey: ['setup-status'] });
    },
  });

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
        {/* Section 1: Geofencing */}
        <Card>
          <CardContent className="pt-6">
            {/* Country */}
            <div className="flex items-center gap-8">
              <div className="w-1/2 shrink-0">
                <label className="text-sm font-medium block">Country</label>
                <p className="text-sm text-muted-foreground mt-1">
                  Select the country where cameras are deployed. Filters out species that do not occur in this country.
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

        {/* Section 2: Taxonomy CSV upload */}
        <Card>
          <CardHeader>
            <CardTitle>Taxonomy mapping</CardTitle>
            <CardDescription>
              Upload a CSV with <code>latin</code> and <code>common</code> columns.
              This replaces any existing mapping and reprocesses all existing classifications.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div
              {...getRootProps()}
              className={`border-2 border-dashed rounded-lg p-8 sm:p-12 text-center cursor-pointer transition-colors ${
                isDragActive
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/50 hover:bg-accent/50'
              }`}
            >
              <input {...getInputProps()} />
              <div className="flex flex-col items-center space-y-4">
                <FileSpreadsheet className="h-8 w-8 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">
                    {isDragActive ? 'Drop CSV here...' : 'Drag and drop a CSV file here, or click to select'}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Required columns: latin, common. Extra columns are ignored.
                  </p>
                </div>
              </div>
            </div>

          </CardContent>
        </Card>

        {/* Section 3: Current mapping table */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Current mapping</CardTitle>
                {entries.length > 0 && (
                  <CardDescription>{entries.length} entries</CardDescription>
                )}
              </div>
              {entries.length > 0 && (
                <div>
                  {showClearConfirm ? (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">Are you sure?</span>
                      <button
                        onClick={() => clearMutation.mutate()}
                        disabled={clearMutation.isPending}
                        className="px-3 py-1.5 text-sm bg-destructive text-destructive-foreground rounded-md hover:bg-destructive/90 disabled:opacity-50"
                      >
                        {clearMutation.isPending ? 'Clearing...' : 'Yes, clear'}
                      </button>
                      <button
                        onClick={() => setShowClearConfirm(false)}
                        className="px-3 py-1.5 text-sm border border-border rounded-md hover:bg-accent"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowClearConfirm(true)}
                      className="flex items-center gap-2 px-3 py-1.5 text-sm text-destructive border border-destructive/30 rounded-md hover:bg-destructive/10"
                    >
                      <Trash2 className="h-4 w-4" />
                      Clear mapping
                    </button>
                  )}
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {taxonomyLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : entries.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Upload className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>No taxonomy mapping configured. Upload a CSV to get started.</p>
              </div>
            ) : (
              <div className="border rounded-lg overflow-hidden">
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
              {uploadModal.error ? (
                <>
                  <div className="flex items-center gap-3 mb-4">
                    <XCircle className="h-5 w-5 text-red-500 shrink-0" />
                    <h3 className="text-lg font-semibold">Upload failed</h3>
                  </div>
                  <p className="text-sm text-muted-foreground mb-6">{uploadModal.error}</p>
                  <div className="flex justify-end">
                    <Button onClick={() => setUploadModal({ open: false, event: null, error: null })}>
                      Close
                    </Button>
                  </div>
                </>
              ) : uploadModal.event?.stage === 'done' ? (
                <>
                  <div className="flex items-center gap-3 mb-4">
                    <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
                    <h3 className="text-lg font-semibold">Upload complete</h3>
                  </div>
                  <p className="text-sm text-muted-foreground mb-1">
                    Uploaded {uploadModal.event.count} taxonomy entries.
                  </p>
                  {(uploadModal.event.reprocessed_count ?? 0) > 0 && (
                    <p className="text-sm text-muted-foreground mb-1">
                      {uploadModal.event.reprocessed_count} classifications reprocessed.
                    </p>
                  )}
                  <div className="flex justify-end mt-6">
                    <Button onClick={() => setUploadModal({ open: false, event: null, error: null })}>
                      Close
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-3 mb-4">
                    <Loader2 className="h-5 w-5 animate-spin text-primary shrink-0" />
                    <h3 className="text-lg font-semibold">
                      {uploadModal.event?.stage === 'reprocessing'
                        ? 'Reprocessing classifications...'
                        : 'Uploading taxonomy...'}
                    </h3>
                  </div>
                  {uploadModal.event?.stage === 'reprocessing' && uploadModal.event.total! > 0 && (
                    <div className="space-y-2">
                      <div className="w-full bg-muted rounded-full h-2">
                        <div
                          className="bg-primary h-2 rounded-full transition-all duration-300"
                          style={{
                            width: `${Math.round(((uploadModal.event.current ?? 0) / uploadModal.event.total!) * 100)}%`,
                          }}
                        />
                      </div>
                      <p className="text-sm text-muted-foreground text-center">
                        {uploadModal.event.current?.toLocaleString()} / {uploadModal.event.total?.toLocaleString()} classifications
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </ServerPageLayout>
  );
};
