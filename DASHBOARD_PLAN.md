# Dashboard Implementation Plan

**Status:** Planning
**Created:** 2026-01-30
**Target:** Enhanced dashboard for ecologists, conservationists, and rangers

---

## Todo List

### High value / feasible now

- [ ] **Activity pattern (radial)** - Polar chart showing 24-hour activity clock
  - [ ] API endpoint: `GET /api/statistics/activity-pattern`
  - [ ] Frontend: Radial/polar chart component with species selector

- [ ] **Species accumulation curve** - Line chart showing cumulative species discovered over time
  - [ ] API endpoint: `GET /api/statistics/species-accumulation`
  - [ ] Frontend: Cumulative line chart

- [ ] **Detection rate over time** - Line chart showing detections per day
  - [ ] API endpoint: `GET /api/statistics/detection-trend`
  - [ ] Frontend: Line chart with species filter and date range selector

- [ ] **Species comparison activity** - Compare activity patterns between species
  - [ ] API endpoint: extend activity-pattern to support multiple species
  - [ ] Frontend: Multi-line or overlay chart

- [ ] **Camera health heatmap** - Table/matrix showing camera status at a glance
  - [ ] API endpoint: `GET /api/statistics/camera-health-summary`
  - [ ] Frontend: Status grid or heatmap table

- [ ] **Weekly/monthly trends** - Bar chart showing activity by week/month
  - [ ] API endpoint: extend detection-trend with grouping parameter
  - [ ] Frontend: Grouped bar chart

### Medium value / some work needed

- [ ] **Occupancy by camera** - Heatmap matrix showing species x camera presence
  - [ ] API endpoint: `GET /api/statistics/occupancy-matrix`
  - [ ] Frontend: Heatmap matrix component

- [ ] **Detection confidence histogram** - Distribution of detection confidences
  - [ ] API endpoint: `GET /api/statistics/confidence-distribution`
  - [ ] Frontend: Histogram chart

- [ ] **Person/vehicle alerts** - Counter showing non-animal detections
  - [ ] API endpoint: extend overview to include person/vehicle counts
  - [ ] Frontend: Alert cards or counter badges

- [ ] **Processing pipeline status** - Show pending vs classified images
  - [ ] API endpoint: `GET /api/statistics/pipeline-status`
  - [ ] Frontend: Status cards with counts

---

## Current State

The existing dashboard (`Dashboard.tsx`) has 4 basic visualizations:
1. **Summary cards**: Total images, cameras, species, images today
2. **Line chart**: Images uploaded over last 30 days
3. **Doughnut chart**: Camera activity status (active/inactive/never reported)
4. **Horizontal bar chart**: Top 10 species by detection count

---

## Available Data (from dev server)

| Data Point | Current Count | Notes |
|------------|---------------|-------|
| Images | 519 | April 2025 - January 2026 |
| Cameras | 20 | Mix of WUH01-11 and IMEI-named |
| Detections | 695 | 647 animal, 44 person, 4 vehicle |
| Classifications | 647 | 17 unique species |
| Deployment periods | 10+ | Location + date ranges |

**Species distribution:**
- Fox: 179 (most common)
- Fallow deer: 175
- Lagomorph: 66
- Cow: 58
- Roe deer: 51
- Bird: 46
- Plus 11 more species (dog, mustelid, raccoon dog, bison, etc.)

**Temporal patterns observed:**
- Clear diel activity patterns (nocturnal vs diurnal species)
- Fox peaks at night (21:00-05:00)
- Fallow deer crepuscular (peaks at 02:00 and 19:00)
- Birds diurnal (peaks at 10:00-17:00)
- Day of week variation visible

---

## What Ecologists, Conservationists, and Rangers Need

Based on research (see sources below), these professionals need:

### 1. Activity patterns (diel/circadian)

The most requested visualization. Wildlife Insights shows both:
- **Radial plot**: 24-hour clock showing activity frequency per hour
- **Line graph**: With confidence intervals

This is crucial for understanding:
- When species are active (for patrol planning)
- Temporal niche partitioning between species
- Changes in behavior due to human disturbance

### 2. Detection/abundance metrics

Per research on detection rates:
- **Relative Abundance Index (RAI)**: Detections per 100 trap-days (already in map)
- **Occupancy rates**: Proportion of sites where species detected
- **Detection probability**: How likely to detect if present

### 3. Effort-corrected metrics

Raw counts are misleading without accounting for sampling effort:
- Trap-days per camera
- Detection rate per 100 trap-days (already have this)
- Cumulative effort over time

### 4. Spatial patterns

- Species richness maps (how many species per area)
- Detection rate heat maps (already have hexbin view)
- Species-specific distribution maps

### 5. Camera health overview

For rangers/field teams:
- Battery status across fleet
- SD card usage
- Cameras that haven't reported
- Maintenance priorities

---

## Visualization Ideas (Prioritized)

### High value / feasible now

| Visualization | Type | Data Available | Library |
|---------------|------|----------------|---------|
| **Activity pattern (radial)** | Polar/radar chart | Yes - hourly counts | Chart.js (polarArea) |
| **Species accumulation curve** | Line chart | Yes - date + species | Chart.js |
| **Detection rate over time** | Line chart | Yes - dates + detections | Chart.js |
| **Species comparison activity** | Multi-line or stacked | Yes | Chart.js |
| **Camera health heatmap** | Table/matrix | Partial (last_seen) | Custom or library |
| **Weekly/monthly trends** | Bar chart | Yes | Chart.js |

### Medium value / some work needed

| Visualization | Type | Data Available | Notes |
|---------------|------|----------------|-------|
| **Occupancy by camera** | Heatmap matrix | Yes | Species x Camera matrix |
| **Detection confidence histogram** | Histogram | Yes | Already have distribution data |
| **Person/vehicle alerts** | Counter/list | Yes | 44 persons, 4 vehicles detected |
| **Processing pipeline status** | Status cards | Yes | pending/classified counts |

### High value / needs more data

| Visualization | Type | What's Missing | Priority |
|---------------|------|----------------|----------|
| **Battery fleet status** | Gauge/bars | Battery data empty | Will populate when cameras report |
| **Seasonal comparison** | Line chart | Need more months | Time will provide this |
| **Multi-year trends** | Line chart | Need more data | Future |

---

## Recommended Dashboard Layout

```
┌─────────────────────────────────────────────────────────────────┐
│                      SUMMARY CARDS (4)                          │
│  [Images] [Cameras] [Species] [Today's Activity]                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌───────────────────────┐    ┌───────────────────────────────┐ │
│  │  ACTIVITY PATTERN     │    │  IMAGES OVER TIME            │ │
│  │  (Radial 24h clock)   │    │  (Line chart - 30 days)      │ │
│  │                       │    │                               │ │
│  │  Select species: [▼]  │    │                               │ │
│  └───────────────────────┘    └───────────────────────────────┘ │
│                                                                 │
│  ┌───────────────────────┐    ┌───────────────────────────────┐ │
│  │  SPECIES DISTRIBUTION │    │  CAMERA STATUS               │ │
│  │  (Horizontal bars)    │    │  (Doughnut or status grid)   │ │
│  │                       │    │                               │ │
│  │  Top 10 species       │    │  Active / Inactive / Silent  │ │
│  └───────────────────────┘    └───────────────────────────────┘ │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  DETECTION RATE TREND                                       ││
│  │  (Line chart - detections per day, with species filter)     ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  ┌───────────────────────┐    ┌───────────────────────────────┐ │
│  │  RECENT DETECTIONS    │    │  SPECIES ACCUMULATION        │ │
│  │  (Thumbnail grid)     │    │  (Cumulative curve)          │ │
│  │                       │    │                               │ │
│  │  Last 8 with species  │    │  New species discovered/week │ │
│  └───────────────────────┘    └───────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## Technical Implementation Notes

### Already available in package.json

- `chart.js` + `react-chartjs-2` - All chart types including polar/radar
- `leaflet` + `react-leaflet` - Maps (already using for detection rate map)
- `@turf/*` - Spatial analysis (already using for hexbins)
- `chroma-js` - Color scales

### New API endpoints needed

1. `GET /api/statistics/activity-pattern?species=fox` - Hourly counts
2. `GET /api/statistics/species-accumulation` - Cumulative species over time
3. `GET /api/statistics/detection-trend` - Daily detection counts
4. `GET /api/statistics/camera-health-summary` - Fleet battery/SD/status

---

## Implementation Phases

### Phase 1: Activity pattern chart
- Add new API endpoint for hourly activity data
- Implement radial/polar chart component
- Add species selector dropdown

### Phase 2: Detection trends
- Add API endpoint for daily detection counts by species
- Implement multi-line chart with species filter
- Add date range selector

### Phase 3: Species accumulation
- Add API endpoint for cumulative species discovery
- Implement accumulation curve chart

### Phase 4: Camera health overview
- Enhance camera health API
- Add fleet status visualization (when battery data available)

### Phase 5: Recent detections grid
- Add thumbnail grid component
- Show last N classified images with species labels

---

## Sources

Research on camera trap dashboards and ecological metrics:
- [Wildlife Insights Platform](https://www.wildlifeinsights.org/get-started/analyze/generate) - Activity patterns with radial plots
- [Do occupancy or detection rates reflect deer density?](https://academic.oup.com/jmammal/article/98/6/1547/4430381) - RAI methodology
- [Comparing diel activity patterns across latitudes](https://besjournals.onlinelibrary.wiley.com/doi/full/10.1111/2041-210X.13290) - Time transformations
- [Estimating wildlife activity curves](https://www.nature.com/articles/s41598-018-22638-6) - Methods comparison
- [camtrapR package](https://www.biorxiv.org/content/10.1101/2025.09.26.678697v1.full) - Standard analytical workflows
- [Camera trap placement study](https://www.nature.com/articles/s41598-021-02459-w) - Study design recommendations
