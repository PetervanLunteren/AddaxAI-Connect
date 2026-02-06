/**
 * Images page with grid view and filters
 */
import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Calendar, Camera, Grid3x3, ChevronLeft, ChevronRight, SlidersHorizontal, Check } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { MultiSelect, Option } from '../components/ui/MultiSelect';
import { Checkbox } from '../components/ui/Checkbox';
import { imagesApi } from '../api/images';
import { camerasApi } from '../api/cameras';
import { statisticsApi } from '../api/statistics';
import { ImageDetailModal } from '../components/ImageDetailModal';
import { ImageThumbnailWithBoxes } from '../components/ImageThumbnailWithBoxes';
import { normalizeLabel } from '../utils/labels';
import { getSpeciesColor, getSpeciesTextColor, setSpeciesContext } from '../utils/species-colors';
import type { ImageListItem } from '../api/types';

export const ImagesPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [selectedImageUuid, setSelectedImageUuid] = useState<string | null>(null);
  const [pendingFirstImage, setPendingFirstImage] = useState(false);
  const [pendingLastImage, setPendingLastImage] = useState(false);
  const [nextPageFirstUuid, setNextPageFirstUuid] = useState<string | null>(null);
  const [prevPageLastUuid, setPrevPageLastUuid] = useState<string | null>(null);

  const [filters, setFilters] = useState({
    camera_ids: [] as Option[],
    start_date: '',
    end_date: '',
    species: [] as Option[],
    show_empty: false, // Default: hide empty images
  });
  const [showFilters, setShowFilters] = useState(false);

  const limit = 24; // Images per page

  // Fetch images with current filters and pagination
  const { data: imagesData, isLoading: imagesLoading } = useQuery({
    queryKey: ['images', page, filters],
    queryFn: () =>
      imagesApi.getAll({
        page,
        limit,
        camera_id: filters.camera_ids.length > 0
          ? filters.camera_ids.map(c => c.value).join(',')
          : undefined,
        start_date: filters.start_date || undefined,
        end_date: filters.end_date || undefined,
        species: filters.species.length > 0
          ? filters.species.map(s => s.value).join(',')
          : undefined,
        show_empty: filters.show_empty,
      }),
  });

  // Fetch cameras for filter dropdown
  const { data: cameras } = useQuery({
    queryKey: ['cameras'],
    queryFn: () => camerasApi.getAll(),
  });

  // Fetch species for filter dropdown
  const { data: speciesOptions, isLoading: speciesLoading } = useQuery({
    queryKey: ['species'],
    queryFn: () => imagesApi.getSpecies(),
  });

  // Fetch overview for date bounds
  const { data: overview } = useQuery({
    queryKey: ['statistics', 'overview'],
    queryFn: () => statisticsApi.getOverview(),
  });

  const handleFilterChange = (key: string, value: any) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1); // Reset to first page when filters change
  };

  const clearFilters = () => {
    setFilters({
      camera_ids: [],
      start_date: '',
      end_date: '',
      species: [],
      show_empty: false,
    });
    setPage(1);
  };

  const hasActiveFilters =
    filters.camera_ids.length > 0 ||
    filters.start_date !== '' ||
    filters.end_date !== '' ||
    filters.species.length > 0 ||
    filters.show_empty;

  const formatTimestamp = (timestamp: string) => {
    // Handle EXIF format: "2024:12:22 10:30:45" -> "2024-12-22T10:30:45"
    const exifFormatted = timestamp.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
    const date = new Date(exifFormatted);

    if (isNaN(date.getTime())) {
      return timestamp; // Return original if can't parse
    }

    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  };

  // Set species context using the full species list for consistent colors app-wide
  useMemo(() => {
    if (speciesOptions && speciesOptions.length > 0) {
      const allSpecies = speciesOptions.map(s => s.value as string);
      // Add categories and 'empty' as fallbacks
      allSpecies.push('animal', 'person', 'vehicle', 'empty');
      setSpeciesContext(allSpecies);
    }
  }, [speciesOptions]);

  // Handle cross-page navigation: select first/last image after page loads
  useEffect(() => {
    if (imagesData?.items.length > 0) {
      if (pendingFirstImage) {
        setSelectedImageUuid(imagesData.items[0].uuid);
        setPendingFirstImage(false);
      } else if (pendingLastImage) {
        setSelectedImageUuid(imagesData.items[imagesData.items.length - 1].uuid);
        setPendingLastImage(false);
      }
    }
  }, [imagesData, pendingFirstImage, pendingLastImage]);

  // Prefetch adjacent page data when at page boundary (for cross-page image prefetching)
  useEffect(() => {
    if (!selectedImageUuid || !imagesData) return;

    const currentIndex = imagesData.items.findIndex(img => img.uuid === selectedImageUuid);
    if (currentIndex === -1) return;

    const queryParams = {
      limit,
      camera_id: filters.camera_ids.length > 0
        ? filters.camera_ids.map(c => c.value).join(',')
        : undefined,
      start_date: filters.start_date || undefined,
      end_date: filters.end_date || undefined,
      species: filters.species.length > 0
        ? filters.species.map(s => s.value).join(',')
        : undefined,
      show_empty: filters.show_empty,
    };

    // On last image of page → prefetch next page's first image UUID
    if (currentIndex === imagesData.items.length - 1 && page < imagesData.pages) {
      queryClient.fetchQuery({
        queryKey: ['images', page + 1, filters],
        queryFn: () => imagesApi.getAll({ ...queryParams, page: page + 1 }),
      }).then(data => {
        if (data?.items[0]) {
          setNextPageFirstUuid(data.items[0].uuid);
        }
      }).catch(() => {}); // Silently fail, it's just prefetching
    } else {
      setNextPageFirstUuid(null);
    }

    // On first image of page → prefetch previous page's last image UUID
    if (currentIndex === 0 && page > 1) {
      queryClient.fetchQuery({
        queryKey: ['images', page - 1, filters],
        queryFn: () => imagesApi.getAll({ ...queryParams, page: page - 1 }),
      }).then(data => {
        if (data?.items.length > 0) {
          setPrevPageLastUuid(data.items[data.items.length - 1].uuid);
        }
      }).catch(() => {});
    } else {
      setPrevPageLastUuid(null);
    }
  }, [selectedImageUuid, imagesData, page, filters, queryClient]);

  return (
    <div>
      <div className="relative">
        <h1 className="text-2xl font-bold mb-0">Images</h1>
        <p className="text-sm text-gray-600 mt-1 mb-6">Browse and filter captured wildlife images</p>
        <div className="absolute top-0 right-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-2"
          >
            <SlidersHorizontal className="h-4 w-4" />
            {showFilters ? 'Hide Filters' : 'Show Filters'}
            {hasActiveFilters && (
              <span className="px-1.5 py-0.5 text-xs bg-primary text-primary-foreground rounded-full">
                {filters.camera_ids.length + filters.species.length +
                 (filters.start_date ? 1 : 0) + (filters.end_date ? 1 : 0) +
                 (filters.show_empty ? 1 : 0)}
              </span>
            )}
          </Button>
        </div>
      </div>

      {/* Filters */}
      {showFilters && (
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="block text-sm font-medium mb-2">Cameras</label>
                <MultiSelect
                  options={cameras?.map(camera => ({
                    label: camera.name,
                    value: camera.id,
                  })) || []}
                  value={filters.camera_ids}
                  onChange={(selected) => handleFilterChange('camera_ids', selected)}
                  placeholder="Select cameras..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Start date</label>
                <input
                  type="date"
                  className="w-full h-10 px-3 border border-input rounded-md bg-background"
                  value={filters.start_date}
                  onChange={(e) => handleFilterChange('start_date', e.target.value)}
                  min={overview?.first_image_date || undefined}
                  max={overview?.last_image_date || undefined}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">End date</label>
                <input
                  type="date"
                  className="w-full h-10 px-3 border border-input rounded-md bg-background"
                  value={filters.end_date}
                  onChange={(e) => handleFilterChange('end_date', e.target.value)}
                  min={overview?.first_image_date || undefined}
                  max={overview?.last_image_date || undefined}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Species</label>
                <MultiSelect
                  options={speciesOptions || []}
                  value={filters.species}
                  onChange={(selected) => handleFilterChange('species', selected)}
                  placeholder="Select species..."
                  isLoading={speciesLoading}
                />
              </div>
            </div>

            {/* Show Empty Images Toggle */}
            <div className="mt-4">
              <Checkbox
                id="show-empty"
                checked={filters.show_empty}
                onChange={(checked) => handleFilterChange('show_empty', checked)}
                label="Show images without detections"
              />
            </div>

            {hasActiveFilters && (
              <div className="mt-4">
                <Button variant="outline" size="sm" onClick={clearFilters}>
                  Clear All Filters
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}


      {/* Image Grid */}
      {imagesLoading ? (
        <div className="flex items-center justify-center py-12">
          <p className="text-muted-foreground">Loading images...</p>
        </div>
      ) : imagesData && imagesData.items.length > 0 ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {imagesData.items.map((image: ImageListItem) => (
              <Card
                key={image.uuid}
                className="cursor-pointer hover:shadow-lg transition-shadow relative"
                onClick={() => setSelectedImageUuid(image.uuid)}
              >
                {/* Verified badge - overflow top-right corner */}
                {image.is_verified && (
                  <div
                    className="absolute -top-2 -right-2 w-6 h-6 rounded-full flex items-center justify-center z-10"
                    style={{ backgroundColor: '#0f6064' }}
                    title="Verified"
                  >
                    <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />
                  </div>
                )}
                <div className="aspect-[4/3] bg-muted relative overflow-hidden rounded-t-lg">
                  {image.thumbnail_url ? (
                    <ImageThumbnailWithBoxes
                      thumbnailUrl={image.thumbnail_url}
                      alt={image.filename}
                      detections={image.detections}
                      imageWidth={image.image_width}
                      imageHeight={image.image_height}
                      className="w-full object-contain rounded-t-lg"
                      fallback={
                        <div className="flex items-center justify-center h-full">
                          <Grid3x3 className="h-12 w-12 text-muted-foreground" />
                        </div>
                      }
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full">
                      <Grid3x3 className="h-12 w-12 text-muted-foreground" />
                    </div>
                  )}
                  {(() => {
                    // Extract classification labels (species) from all detections
                    const speciesLabels = Array.from(new Set(
                      image.detections.flatMap(detection =>
                        detection.classifications.map(cls => cls.species)
                      )
                    ));

                    // If no species, fall back to detection categories
                    const categoryLabels = speciesLabels.length === 0
                      ? Array.from(new Set(
                          image.detections.map(detection => detection.category)
                        ))
                      : [];

                    // Combine labels: prefer species, fallback to categories, finally "empty"
                    const allLabels = speciesLabels.length > 0
                      ? speciesLabels
                      : categoryLabels.length > 0
                        ? categoryLabels
                        : ['empty'];

                    // Show first 2 labels + count of remaining
                    const visibleLabels = allLabels.slice(0, 2);
                    const remainingCount = allLabels.length - 2;

                    return (
                      <div className="absolute top-2 right-2 flex flex-wrap gap-1 justify-end max-w-[calc(100%-1rem)]">
                        {visibleLabels.map((label, idx) => (
                          <span
                            key={`${label}-${idx}`}
                            className="px-2 py-1 rounded-md text-xs font-medium"
                            style={{
                              backgroundColor: getSpeciesColor(label),
                              color: getSpeciesTextColor(label),
                            }}
                          >
                            {normalizeLabel(label)}
                          </span>
                        ))}
                        {remainingCount > 0 && (
                          <span className="bg-gray-600 text-white px-2 py-1 rounded-md text-xs font-medium">
                            +{remainingCount} more
                          </span>
                        )}
                      </div>
                    );
                  })()}
                </div>
                <CardContent className="p-4">
                  <div className="space-y-2">
                    {/* Camera Name */}
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Camera className="h-3 w-3" />
                      <span className="truncate">{image.camera_name}</span>
                    </div>

                    {/* Timestamp */}
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Calendar className="h-3 w-3" />
                      <span>{formatTimestamp(image.datetime_captured || image.uploaded_at)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Pagination */}
          <div className="mt-6 flex flex-col items-center gap-3">
            <div className="text-sm text-muted-foreground">
              Showing {(page - 1) * limit + 1} - {Math.min(page * limit, imagesData.total)} of{' '}
              {imagesData.total} images
            </div>
            {imagesData.pages > 1 && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </Button>

              <div className="flex items-center gap-1">
                {Array.from({ length: Math.min(5, imagesData.pages) }, (_, i) => {
                  let pageNum: number;
                  if (imagesData.pages <= 5) {
                    pageNum = i + 1;
                  } else if (page <= 3) {
                    pageNum = i + 1;
                  } else if (page >= imagesData.pages - 2) {
                    pageNum = imagesData.pages - 4 + i;
                  } else {
                    pageNum = page - 2 + i;
                  }

                  return (
                    <Button
                      key={pageNum}
                      variant={page === pageNum ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setPage(pageNum)}
                      className="min-w-[2.5rem]"
                    >
                      {pageNum}
                    </Button>
                  );
                })}
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(imagesData.pages, p + 1))}
                disabled={page === imagesData.pages}
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            )}
          </div>
        </>
      ) : (
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <Grid3x3 className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground">
                {hasActiveFilters
                  ? 'No images match the current filters.'
                  : 'No images uploaded yet.'}
              </p>
              {hasActiveFilters && (
                <Button variant="link" onClick={clearFilters} className="mt-2">
                  Clear filters
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Image Detail Modal */}
      {selectedImageUuid && imagesData && (() => {
        const currentIndex = imagesData.items.findIndex(img => img.uuid === selectedImageUuid);
        return (
          <ImageDetailModal
            imageUuid={selectedImageUuid}
            allImageUuids={imagesData.items.map(img => img.uuid)}
            nextPageFirstUuid={nextPageFirstUuid}
            prevPageLastUuid={prevPageLastUuid}
            isOpen={!!selectedImageUuid}
            onClose={() => setSelectedImageUuid(null)}
            onPrevious={() => {
              if (currentIndex > 0) {
                setSelectedImageUuid(imagesData.items[currentIndex - 1].uuid);
              } else if (page > 1) {
                // Go to previous page, select last image
                setPage(page - 1);
                setPendingLastImage(true);
              }
            }}
            onNext={() => {
              if (currentIndex < imagesData.items.length - 1) {
                setSelectedImageUuid(imagesData.items[currentIndex + 1].uuid);
              } else if (page < imagesData.pages) {
                // Go to next page, select first image
                setPage(page + 1);
                setPendingFirstImage(true);
              }
            }}
            hasPrevious={currentIndex > 0 || page > 1}
            hasNext={currentIndex < imagesData.items.length - 1 || page < imagesData.pages}
          />
        );
      })()}
    </div>
  );
};
