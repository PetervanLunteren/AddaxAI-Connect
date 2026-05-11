/**
 * Four summary cards rendered above every Insights -> Performance page:
 * verified-image count, top-1 accuracy, weighted F1, macro F1.
 */
import React, { useMemo } from 'react';
import { Activity, BarChart3, CheckCircle2, Target } from 'lucide-react';
import { Card, CardContent } from '../ui/Card';
import type { PerformanceData } from '../../api/performance';
import { computeDetailedMetrics, formatPercent } from '../../utils/performance-metrics';

const CARD_COLOR = '#0f6064';

export const PerformanceSummaryCards: React.FC<{ data: PerformanceData }> = ({ data }) => {
  const m = useMemo(() => computeDetailedMetrics(data), [data]);
  const fmt = (v: number | null) => (v === null ? 'n/a' : formatPercent(v));

  const cards = [
    { title: 'Verified images', value: data.total_verified_images.toLocaleString(), icon: CheckCircle2 },
    { title: 'Top-1 accuracy', value: fmt(data.matrix_accuracy), icon: Target },
    { title: 'Weighted avg F1', value: fmt(m.weightedF1), icon: Activity },
    { title: 'Macro avg F1', value: fmt(m.macroF1), icon: BarChart3 },
  ];

  return (
    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.title}>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">{card.title}</p>
                <p className="text-2xl font-bold mt-1">{card.value}</p>
              </div>
              <div className="p-3 rounded-lg" style={{ backgroundColor: `${CARD_COLOR}20` }}>
                <card.icon className="h-6 w-6" style={{ color: CARD_COLOR }} />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
};
