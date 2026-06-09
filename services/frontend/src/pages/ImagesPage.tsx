/**
 * Images page with grid view and filters
 */
import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Calendar, Camera, Grid3x3, ChevronLeft, ChevronRight, Check, Heart, Flag } from 'lucide-react';
import { Card, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import {
  FilterBar,
  type FilterFieldDef,
  type FilterValue,
} from '../components/ui/FilterBar';
import {
  filtersFromSearchParams,
  filtersToSearchParams,
  type FilterSchema,
} from '../lib/filter-url';
import { imagesApi } from '../api/images';
import { camerasApi } from '../api/cameras';
import { sitesApi } from '../api/sites';
import { statisticsApi } from '../api/statistics';
import { ImageDetailModal } from '../components/ImageDetailModal';
import { ImageThumbnailWithBoxes } from '../components/ImageThumbnailWithBoxes';
import { formatDateTime } from '../utils/datetime';
import { normalizeLabel } from '../utils/labels';
import { getSpeciesColor, getSpeciesTextColor, setSpeciesContext } from '../utils/species-colors';
import { useProject } from '../contexts/ProjectContext';
import type { ImageListItem } from '../api/types';

const FILTER_SCHEMA: FilterSchema = {
  camera_ids: 'string[]',
  // The site slideout's "View images" deep-links here; rendered as a Site
  // dropdown so it shows a clearable chip like every other filter. The
  // deployment slideout instead deep-links camera + date range (existing fields).
  site_id: 'string',
  tags: 'string[]',
  species: 'string[]',
  date_from: 'date',
  date_to: 'date',
  verified: 'string',
  liked: 'string',
  needs_review: 'string',
  min_detection_confidence: 'number',
  max_detection_confidence: 'number',
  min_classification_confidence: 'number',
  max_classification_confidence: 'number',
  // Confusion-matrix cell-click filters. Image-level top-1, see images.py.
  human_top: 'string',
  ai_top: 'string',
};

const formatPct = (lo: number, hi: number): string =>
  `${Math.round(lo * 100)}% - ${Math.round(hi * 100)}%`;

const asStringArray = (v: string | string[] | undefined): string[] =>
  Array.isArray(v) ? v : [];
const asString = (v: string | string[] | undefined): string =>
  typeof v === 'string' ? v : '';

export const ImagesPage: React.FC = () => {
  const queryClient = useQueryClient();
  const { selectedProject } = useProject();
  const projectId = selectedProject?.id;
  const [searchParams, setSearchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [selectedImageUuid, setSelectedImageUuid] = useState<string | null>(null);
  const [pendingFirstImage, setPendingFirstImage] = useState(false);
  const [pendingLastImage, setPendingLastImage] = useState(false);
  const [nextPageFirstUuid, setNextPageFirstUuid] = useState<string | null>(null);
  const [prevPageLastUuid, setPrevPageLastUuid] = useState<string | null>(null);

  // Filter state lives in the URL via FILTER_SCHEMA. The page reads from
  // useSearchParams on every render; writes go through filtersToSearchParams.
  const parsed = filtersFromSearchParams(searchParams, FILTER_SCHEMA);
  const cameraIdValues = asStringArray(parsed.camera_ids);
  const siteId = asString(parsed.site_id);
  const tagValues = asStringArray(parsed.tags);
  const speciesValues = asStringArray(parsed.species);
  const startDate = asString(parsed.date_from);
  const endDate = asString(parsed.date_to);
  const verified = asString(parsed.verified) as '' | 'true' | 'false';
  const liked = asString(parsed.liked) as '' | 'true' | 'false';
  const needsReview = asString(parsed.needs_review) as '' | 'true' | 'false';
  const humanTop = asString(parsed.human_top);
  const aiTop = asString(parsed.ai_top);
  const minDetConf = asString(parsed.min_detection_confidence);
  const maxDetConf = asString(parsed.max_detection_confidence);
  const minClsConf = asString(parsed.min_classification_confidence);
  const maxClsConf = asString(parsed.max_classification_confidence);

  const filterValues = useMemo<Record<string, FilterValue>>(
    () => ({
      camera_ids: cameraIdValues.length > 0 ? cameraIdValues : undefined,
      site_id: siteId || undefined,
      tags: tagValues.length > 0 ? tagValues : undefined,
      species: speciesValues.length > 0 ? speciesValues : undefined,
      date_from: startDate || undefined,
      date_to: endDate || undefined,
      verified: verified || undefined,
      liked: liked || undefined,
      needs_review: needsReview || undefined,
      min_detection_confidence: minDetConf || undefined,
      max_detection_confidence: maxDetConf || undefined,
      min_classification_confidence: minClsConf || undefined,
      max_classification_confidence: maxClsConf || undefined,
      human_top: humanTop || undefined,
      ai_top: aiTop || undefined,
    }),
    [cameraIdValues, siteId, tagValues, speciesValues, startDate, endDate, verified, liked, needsReview, minDetConf, maxDetConf, minClsConf, maxClsConf, humanTop, aiTop],
  );

  const onFilterChange = (patch: Record<string, FilterValue>) => {
    const next = { ...filterValues, ...patch };
    setSearchParams(filtersToSearchParams(next, FILTER_SCHEMA), { replace: true });
    setPage(1);
  };
  const onClearAll = () => {
    setSearchParams(new URLSearchParams(), { replace: true });
    setPage(1);
  };

  const limit = 24; // Images per page

  // Reset page when project changes
  useEffect(() => {
    setPage(1);
  }, [projectId]);

  // Fetch images with current filters and pagination
  const { data: imagesData, isLoading: imagesLoading } = useQuery({
    queryKey: ['images', projectId, page, filterValues],
    queryFn: () =>
      imagesApi.getAll({
        page,
        limit,
        project_id: projectId,
        camera_id: cameraIdValues.length > 0 ? cameraIdValues.join(',') : undefined,
        site_id: siteId ? Number(siteId) : undefined,
        tags: tagValues.length > 0 ? tagValues.join(',') : undefined,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
        species: speciesValues.length > 0 ? speciesValues.join(',') : undefined,
        verified: verified || undefined,
        liked: liked || undefined,
        needs_review: needsReview || undefined,
        min_detection_confidence: minDetConf ? Number(minDetConf) : undefined,
        max_detection_confidence: maxDetConf ? Number(maxDetConf) : undefined,
        min_classification_confidence: minClsConf ? Number(minClsConf) : undefined,
        max_classification_confidence: maxClsConf ? Number(maxClsConf) : undefined,
        human_top: humanTop || undefined,
        ai_top: aiTop || undefined,
      }),
    enabled: projectId !== undefined,
  });

  // Fetch cameras for filter dropdown
  const { data: cameras } = useQuery({
    queryKey: ['cameras', projectId],
    queryFn: () => camerasApi.getAll(projectId),
    enabled: projectId !== undefined,
  });

  // Fetch sites for the Site filter dropdown (and to label the site chip).
  const { data: sites } = useQuery({
    queryKey: ['sites', projectId],
    queryFn: () => sitesApi.list(projectId!),
    enabled: projectId !== undefined,
  });

  // Fetch tag options for filter dropdown
  const { data: tagOptions } = useQuery({
    queryKey: ['camera-tags', projectId],
    queryFn: () => camerasApi.getTags(projectId),
    enabled: projectId !== undefined,
  });

  // Fetch labels for filter dropdown (species + person/vehicle + empty)
  const { data: rawLabelOptions, isLoading: speciesLoading } = useQuery({
    queryKey: ['species', projectId],
    queryFn: () => imagesApi.getSpecies(projectId),
    enabled: projectId !== undefined,
  });

  // Pin Empty, Person, Vehicle at the top; rest alphabetical
  const speciesOptions = React.useMemo(() => {
    if (!rawLabelOptions) return [];
    const pinned = ['empty', 'person', 'vehicle'];
    const pinnedOptions = pinned
      .map(v => rawLabelOptions.find(s => s.value === v))
      .filter((s): s is NonNullable<typeof s> => !!s);
    const rest = rawLabelOptions
      .filter(s => !pinned.includes(s.value as string))
      .sort((a, b) => (a.label as string).localeCompare(b.label as string));
    return [...pinnedOptions, ...rest];
  }, [rawLabelOptions]);

  // Migrate legacy deep links (e.g. ?camera_id=5&show_empty=true) into the
  // current FILTER_SCHEMA shape on mount. Strips the legacy keys after
  // applying so the URL stays clean.
  useEffect(() => {
    if (!cameras || !rawLabelOptions) return;
    const cameraIdParam = searchParams.get('camera_id');
    const showEmptyParam = searchParams.get('show_empty');
    if (!cameraIdParam && !showEmptyParam) return;

    const next: Record<string, FilterValue> = { ...filterValues };

    if (cameraIdParam) {
      const ids = cameraIdParam
        .split(',')
        .filter((id) => cameras.some((c) => String(c.id) === id));
      if (ids.length > 0) next.camera_ids = ids;
    }

    // The excessive-images email links here with show_empty=true. Tick every
    // label so the user lands on all images of the camera, not just the
    // empties that triggered the alert.
    if (showEmptyParam === 'true') {
      next.species = rawLabelOptions.map((opt) => String(opt.value));
    }

    const params = filtersToSearchParams(next, FILTER_SCHEMA);
    setSearchParams(params, { replace: true });
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameras, rawLabelOptions]);

  // Fetch overview for date bounds
  const { data: overview } = useQuery({
    queryKey: ['statistics', 'overview', projectId],
    queryFn: () => statisticsApi.getOverview(projectId),
    enabled: projectId !== undefined,
  });

  const filterFields = useMemo<FilterFieldDef[]>(
    () => [
      {
        kind: 'multi-select',
        key: 'camera_ids',
        label: 'Cameras',
        options: (cameras ?? []).map((c) => ({ label: c.name, value: String(c.id) })),
        placeholder: 'All cameras',
        summary: (n) => `${n} cameras`,
      },
      {
        kind: 'select',
        key: 'site_id',
        label: 'Site',
        options: (sites ?? []).map((s) => ({ value: String(s.id), label: s.name })),
      },
      {
        kind: 'multi-select',
        key: 'tags',
        label: 'Camera tags',
        options: (tagOptions ?? []).map((t) => ({ label: t, value: t })),
        placeholder: 'Any tags',
        summary: (n) => `${n} tags`,
      },
      {
        kind: 'multi-select',
        key: 'species',
        label: 'Labels',
        options: speciesOptions.map((s) => ({
          label: String(s.label),
          value: String(s.value),
        })),
        placeholder: 'All labels',
        isLoading: speciesLoading,
        summary: (n) => `${n} labels`,
      },
      {
        kind: 'date-range',
        fromKey: 'date_from',
        toKey: 'date_to',
        label: 'Date range',
        minDate: overview?.first_image_date,
        maxDate: overview?.last_image_date,
      },
      {
        kind: 'select',
        key: 'verified',
        label: 'Verification',
        primary: false,
        options: [
          { value: 'false', label: 'Unverified' },
          { value: 'true', label: 'Verified' },
        ],
      },
      {
        kind: 'select',
        key: 'liked',
        label: 'Liked',
        primary: false,
        options: [
          { value: 'true', label: 'Liked' },
          { value: 'false', label: 'Not liked' },
        ],
      },
      {
        kind: 'select',
        key: 'needs_review',
        label: 'Review',
        primary: false,
        options: [
          { value: 'true', label: 'Needs review' },
          { value: 'false', label: 'No review needed' },
        ],
      },
      {
        kind: 'range',
        minKey: 'min_detection_confidence',
        maxKey: 'max_detection_confidence',
        label: 'Detection confidence',
        // Clamp the floor to the project's detection threshold; below
        // that, detections are hidden from every other view too, so the
        // slider should match.
        min: selectedProject?.detection_threshold ?? 0,
        max: 1,
        step: 0.05,
        format: formatPct,
        chipPrefix: 'Detection',
        primary: false,
      },
      {
        kind: 'range',
        minKey: 'min_classification_confidence',
        maxKey: 'max_classification_confidence',
        label: 'Classification confidence',
        // Floor at the project-wide default classification threshold,
        // mirroring detection. Per-species overrides aren't useful here
        // because the slider has no species context.
        min: selectedProject?.classification_thresholds?.default ?? 0,
        max: 1,
        step: 0.05,
        format: formatPct,
        chipPrefix: 'Classification',
        primary: false,
      },
    ],
    [cameras, sites, tagOptions, speciesOptions, speciesLoading, overview, selectedProject],
  );

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
      project_id: projectId,
      camera_id: cameraIdValues.length > 0 ? cameraIdValues.join(',') : undefined,
      tags: tagValues.length > 0 ? tagValues.join(',') : undefined,
      start_date: startDate || undefined,
      end_date: endDate || undefined,
      species: speciesValues.length > 0 ? speciesValues.join(',') : undefined,
      verified: verified || undefined,
      liked: liked || undefined,
      needs_review: needsReview || undefined,
      min_detection_confidence: minDetConf ? Number(minDetConf) : undefined,
      max_detection_confidence: maxDetConf ? Number(maxDetConf) : undefined,
      min_classification_confidence: minClsConf ? Number(minClsConf) : undefined,
      max_classification_confidence: maxClsConf ? Number(maxClsConf) : undefined,
      human_top: humanTop || undefined,
      ai_top: aiTop || undefined,
    };

    // On last image of page → prefetch next page's first image UUID
    if (currentIndex === imagesData.items.length - 1 && page < imagesData.pages) {
      queryClient.fetchQuery({
        queryKey: ['images', projectId, page + 1, filterValues],
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
        queryKey: ['images', projectId, page - 1, filterValues],
        queryFn: () => imagesApi.getAll({ ...queryParams, page: page - 1 }),
      }).then(data => {
        if (data?.items.length > 0) {
          setPrevPageLastUuid(data.items[data.items.length - 1].uuid);
        }
      }).catch(() => {});
    } else {
      setPrevPageLastUuid(null);
    }
  }, [selectedImageUuid, imagesData, page, filterValues, queryClient]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-0">Images</h1>
        <p className="text-sm text-gray-600 mt-1">Browse and filter captured wildlife images</p>
      </div>
      <FilterBar
        fields={filterFields}
        values={filterValues}
        onChange={onFilterChange}
        onClearAll={onClearAll}
      />

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
                {/* Status badges - horizontally stacked with overlap, verified on the right */}
                <div className="absolute -top-2 -right-2 z-10 flex flex-row-reverse -space-x-1.5 space-x-reverse">
                  {image.is_verified && (
                    <div
                      className="relative z-30 w-6 h-6 rounded-full flex items-center justify-center ring-2 ring-background"
                      style={{ backgroundColor: '#0f6064' }}
                      title="Verified"
                    >
                      <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />
                    </div>
                  )}
                  {image.is_liked && (
                    <div
                      className="relative z-20 w-6 h-6 rounded-full flex items-center justify-center ring-2 ring-background"
                      style={{ backgroundColor: '#882000' }}
                      title="Liked"
                    >
                      <Heart className="h-3.5 w-3.5 text-white fill-current" strokeWidth={2.5} />
                    </div>
                  )}
                  {image.needs_review && (
                    <div
                      className="relative z-10 w-6 h-6 rounded-full flex items-center justify-center ring-2 ring-background"
                      style={{ backgroundColor: '#71b7ba' }}
                      title="Needs review"
                    >
                      <Flag className="h-3.5 w-3.5 text-white fill-current" strokeWidth={2.5} />
                    </div>
                  )}
                </div>
                <div className="relative overflow-hidden rounded-t-lg">
                  {image.thumbnail_url ? (
                    <ImageThumbnailWithBoxes
                      thumbnailUrl={image.thumbnail_url}
                      alt={image.filename}
                      detections={image.detections}
                      imageWidth={image.image_width}
                      imageHeight={image.image_height}
                      className="w-full object-contain rounded-t-lg"
                      fallback={
                        <div className="flex items-center justify-center h-32 bg-muted">
                          <Grid3x3 className="h-12 w-12 text-muted-foreground" />
                        </div>
                      }
                    />
                  ) : (
                    <div className="flex items-center justify-center h-32 bg-muted">
                      <Grid3x3 className="h-12 w-12 text-muted-foreground" />
                    </div>
                  )}
                  {(() => {
                    // For verified images: use observed_species from human observations
                    // For unverified: extract from AI detections
                    let allLabels: string[];

                    if (image.is_verified) {
                      // Verified image: use human observation data
                      allLabels = image.observed_species && image.observed_species.length > 0
                        ? image.observed_species
                        : ['empty'];
                    } else {
                      // Unverified image: use AI detection data
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
                      allLabels = speciesLabels.length > 0
                        ? speciesLabels
                        : categoryLabels.length > 0
                          ? categoryLabels
                          : ['empty'];
                    }

                    // Show first 2 labels + count of remaining
                    const visibleLabels = allLabels.slice(0, 2);
                    const remainingCount = allLabels.length - 2;

                    return (
                      <div className="absolute bottom-2 left-2 flex flex-wrap gap-1 justify-start max-w-[calc(100%-1rem)]">
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
                      <span>{formatDateTime(image.captured_at)}</span>
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
              {(() => {
                const anyActive = Object.values(filterValues).some(
                  (v) => (Array.isArray(v) ? v.length > 0 : Boolean(v)),
                );
                return (
                  <>
                    <p className="text-muted-foreground">
                      {anyActive
                        ? 'No images match the current filters.'
                        : 'No images uploaded yet.'}
                    </p>
                    {anyActive && (
                      <Button variant="link" onClick={onClearAll} className="mt-2">
                        Clear filters
                      </Button>
                    )}
                  </>
                );
              })()}
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
