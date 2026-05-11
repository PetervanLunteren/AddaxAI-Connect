/**
 * Insights -> Performance page (phase-1 alias).
 *
 * Reuses the existing PerformancePage body verbatim. Phase 4 will split
 * this route into /insights/confusion-matrix and /insights/per-class-performance
 * to match the AddaxAI WebUI structure.
 */
import React from 'react';
import { PerformancePage as LegacyPerformancePage } from '../PerformancePage';

export const InsightsPerformancePage: React.FC = () => {
  // The existing PerformancePage already renders its own header and cards;
  // do not double-wrap in InsightsPageLayout for the phase-1 alias.
  return <LegacyPerformancePage />;
};
