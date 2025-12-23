/**
 * Images page with grid view and filters
 */
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Calendar, Camera, Filter, Grid3x3, ChevronLeft, ChevronRight, PawPrint, Scan } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { imagesApi } from '../api/images';
import { camerasApi } from '../api/cameras';
import { ImageDetailModal } from '../components/ImageDetailModal';
import { ImageThumbnailWithBoxes } from '../components/ImageThumbnailWithBoxes';
import type { ImageListItem } from '../api/types';

export const ImagesPage: React.FC = () => {
  const [page, setPage] = useState(1);
  const [selectedImageUuid, setSelectedImageUuid] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    camera_id: undefined as number | undefined,
    start_date: '',
    end_date: '',
    species: '',
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
        camera_id: filters.camera_id,
        start_date: filters.start_date || undefined,
        end_date: filters.end_date || undefined,
        species: filters.species || undefined,
      }),
  });

  // Fetch cameras for filter dropdown
  const { data: cameras } = useQuery({
    queryKey: ['cameras'],
    queryFn: () => camerasApi.getAll(),
  });

  const handleFilterChange = (key: string, value: any) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1); // Reset to first page when filters change
  };

  const clearFilters = () => {
    setFilters({
      camera_id: undefined,
      start_date: '',
      end_date: '',
      species: '',
    });
    setPage(1);
  };

  const hasActiveFilters =
    filters.camera_id !== undefined ||
    filters.start_date !== '' ||
    filters.end_date !== '' ||
    filters.species !== '';

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Images</h1>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowFilters(!showFilters)}
          className="flex items-center gap-2"
        >
          <Filter className="h-4 w-4" />
          {showFilters ? 'Hide Filters' : 'Show Filters'}
          {hasActiveFilters && (
            <span className="ml-1 px-1.5 py-0.5 text-xs bg-primary text-primary-foreground rounded-full">
              {Object.values(filters).filter((v) => v !== undefined && v !== '').length}
            </span>
          )}
        </Button>
      </div>

      {/* Filters */}
      {showFilters && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Filters</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="block text-sm font-medium mb-2">Camera</label>
                <select
                  className="w-full px-3 py-2 border border-input rounded-md bg-background"
                  value={filters.camera_id || ''}
                  onChange={(e) =>
                    handleFilterChange('camera_id', e.target.value ? parseInt(e.target.value) : undefined)
                  }
                >
                  <option value="">All Cameras</option>
                  {cameras?.map((camera) => (
                    <option key={camera.id} value={camera.id}>
                      {camera.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Start Date</label>
                <input
                  type="date"
                  className="w-full px-3 py-2 border border-input rounded-md bg-background"
                  value={filters.start_date}
                  onChange={(e) => handleFilterChange('start_date', e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">End Date</label>
                <input
                  type="date"
                  className="w-full px-3 py-2 border border-input rounded-md bg-background"
                  value={filters.end_date}
                  onChange={(e) => handleFilterChange('end_date', e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Species</label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border border-input rounded-md bg-background"
                  placeholder="Enter species name..."
                  value={filters.species}
                  onChange={(e) => handleFilterChange('species', e.target.value)}
                />
              </div>
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

      {/* Results Summary */}
      {imagesData && (
        <div className="mb-4 text-sm text-muted-foreground">
          Showing {(page - 1) * limit + 1} - {Math.min(page * limit, imagesData.total)} of{' '}
          {imagesData.total} images
        </div>
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
                className="cursor-pointer hover:shadow-lg transition-shadow"
                onClick={() => setSelectedImageUuid(image.uuid)}
              >
                <div className="aspect-[4/3] bg-muted relative overflow-hidden">
                  {image.thumbnail_url ? (
                    <ImageThumbnailWithBoxes
                      thumbnailUrl={image.thumbnail_url}
                      alt={image.filename}
                      detections={image.detections}
                      imageWidth={image.image_width}
                      imageHeight={image.image_height}
                      className="w-full object-contain"
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
                  {image.detection_count > 0 && (
                    <div className="absolute top-2 right-2 bg-primary text-primary-foreground px-2 py-1 rounded-md text-xs font-medium">
                      {image.detection_count} detection{image.detection_count !== 1 ? 's' : ''}
                    </div>
                  )}
                </div>
                <CardContent className="p-4">
                  <div className="space-y-2">
                    {/* Camera Name */}
                    <div className="flex items-center gap-1 text-sm">
                      <Camera className="h-3 w-3 text-muted-foreground" />
                      <span className="font-medium truncate">{image.camera_name}</span>
                    </div>

                    {/* Timestamp */}
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Calendar className="h-3 w-3" />
                      <span>{formatTimestamp(image.uploaded_at)}</span>
                    </div>

                    {/* Detections List */}
                    {(() => {
                      // Collect unique detection categories
                      const uniqueDetections = Array.from(new Set(
                        image.detections.map(detection => detection.category)
                      ));

                      const detectionsList = uniqueDetections.join(', ');

                      return detectionsList ? (
                        <div className="flex items-start gap-1">
                          <Scan className="h-3 w-3 text-muted-foreground mt-0.5 flex-shrink-0" />
                          <span className="text-xs text-muted-foreground break-words">
                            {detectionsList}
                          </span>
                        </div>
                      ) : null;
                    })()}

                    {/* Species List */}
                    {(() => {
                      // Collect unique species from all classifications
                      const uniqueSpecies = Array.from(new Set(
                        image.detections.flatMap(detection =>
                          detection.classifications.map(cls => cls.species)
                        )
                      ));

                      const speciesList = uniqueSpecies.join(', ');

                      return speciesList ? (
                        <div className="flex items-start gap-1">
                          <PawPrint className="h-3 w-3 text-muted-foreground mt-0.5 flex-shrink-0" />
                          <span className="text-xs text-muted-foreground break-words">
                            {speciesList}
                          </span>
                        </div>
                      ) : null;
                    })()}

                    {/* Filename */}
                    <div className="text-xs text-muted-foreground truncate" title={image.filename}>
                      {image.filename}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Pagination */}
          {imagesData.pages > 1 && (
            <div className="mt-6 flex items-center justify-center gap-2">
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
      {selectedImageUuid && imagesData && (
        <ImageDetailModal
          imageUuid={selectedImageUuid}
          isOpen={!!selectedImageUuid}
          onClose={() => setSelectedImageUuid(null)}
          onPrevious={() => {
            const currentIndex = imagesData.items.findIndex(img => img.uuid === selectedImageUuid);
            if (currentIndex > 0) {
              setSelectedImageUuid(imagesData.items[currentIndex - 1].uuid);
            }
          }}
          onNext={() => {
            const currentIndex = imagesData.items.findIndex(img => img.uuid === selectedImageUuid);
            if (currentIndex < imagesData.items.length - 1) {
              setSelectedImageUuid(imagesData.items[currentIndex + 1].uuid);
            }
          }}
          hasPrevious={imagesData.items.findIndex(img => img.uuid === selectedImageUuid) > 0}
          hasNext={imagesData.items.findIndex(img => img.uuid === selectedImageUuid) < imagesData.items.length - 1}
        />
      )}
    </div>
  );
};
