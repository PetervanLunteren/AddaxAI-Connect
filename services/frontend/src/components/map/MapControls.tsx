/**
 * Map controls component
 * Provides filters for species and date range
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { DetectionRateMapFilters } from '../../api/types';
import { Button } from '../ui/Button';
import { imagesApi } from '../../api/images';

interface MapControlsProps {
  filters: DetectionRateMapFilters;
  onFiltersChange: (filters: DetectionRateMapFilters) => void;
}

export function MapControls({ filters, onFiltersChange }: MapControlsProps) {
  const [species, setSpecies] = useState(filters.species || '');
  const [startDate, setStartDate] = useState(filters.start_date || '');
  const [endDate, setEndDate] = useState(filters.end_date || '');

  // Fetch species for dropdown
  const { data: speciesOptions, isLoading: speciesLoading } = useQuery({
    queryKey: ['species'],
    queryFn: () => imagesApi.getSpecies(),
  });

  const handleApply = () => {
    onFiltersChange({
      species: species || undefined,
      start_date: startDate || undefined,
      end_date: endDate || undefined,
    });
  };

  const handleClear = () => {
    setSpecies('');
    setStartDate('');
    setEndDate('');
    onFiltersChange({});
  };

  const hasFilters = species || startDate || endDate;

  return (
    <div className="mb-4 p-4 bg-white rounded-lg border border-gray-200">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
        <div>
          <label htmlFor="species-filter" className="block text-sm font-medium text-gray-700 mb-1">
            species
          </label>
          <select
            id="species-filter"
            value={species}
            onChange={(e) => setSpecies(e.target.value)}
            disabled={speciesLoading}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white disabled:bg-gray-100"
          >
            <option value="">all species</option>
            {speciesOptions?.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="start-date-filter" className="block text-sm font-medium text-gray-700 mb-1">
            start date
          </label>
          <input
            id="start-date-filter"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label htmlFor="end-date-filter" className="block text-sm font-medium text-gray-700 mb-1">
            end date
          </label>
          <input
            id="end-date-filter"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex gap-2">
          <Button onClick={handleApply} className="flex-1">
            apply
          </Button>
          {hasFilters && (
            <Button onClick={handleClear} variant="outline" className="flex-1">
              clear
            </Button>
          )}
        </div>
      </div>

      {hasFilters && (
        <div className="mt-2 text-sm text-gray-600">
          {species && <span className="mr-3">species: <strong>{species}</strong></span>}
          {startDate && <span className="mr-3">from: <strong>{startDate}</strong></span>}
          {endDate && <span>to: <strong>{endDate}</strong></span>}
        </div>
      )}
    </div>
  );
}
