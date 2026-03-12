# SpeciesNet Integration into AddaxAI-Connect

## The Problem

AddaxAI-Connect currently uses DeepFaune v1.4, which outputs a flat list of 38
European wildlife species. Each label is a single truth: "wolf", "bear", "fox".
This makes notifications, plotting, and species filtering straightforward — a
user says "notify me about wolves" and the system matches on the label "wolf".

SpeciesNet is a much more powerful classifier (2,498 classes, global coverage),
but its output is fundamentally different:

- **Mixed taxonomy levels**: Of its 2,498 classes, 2,066 are species-level, but
  432 are higher taxa (283 genus, 108 family, 30 order, 9 class). For example,
  it has both `american black bear` (species) and `bear family` (family-level
  ursidae), and both `common blackbird` (species) and `bird` (class-level aves).
- **Ensemble rollup**: The SpeciesNet ensemble rolls up uncertain predictions to
  higher taxonomy levels. A bear image might come back as `ursus americanus`,
  `ursidae`, `mammalia`, or even `animal` depending on confidence.
- **Geofencing interleaved with rollup**: When a species is geofenced out (not
  found in the specified country), the ensemble rolls up to the nearest allowed
  ancestor taxon rather than returning unknown.

This means a "bear" could be reported as any of: `ursus americanus`, `ursus
arctos`, `ursidae`, `carnivora`, `mammalia`, or `animal`. Setting notification
rules or building dashboards against unpredictable taxonomy levels is not
practical.

## What We Explored

### Raw softmax access

The SpeciesNet classifier produces softmax scores over all 2,498 classes
(`classifier.py:239-241`). Currently only the top-5 are returned, but the full
distribution is available. This means we could in theory apply our own filtering
and normalization.

### Geofence as species allow-list

The geofence map (`data/geofence_base.json`) contains 17,709 entries, all at
species level (class;order;family;genus;species). It maps species to allowed
countries via `allow` and `block` rules. We considered using this to populate the
species picker in AddaxAI-Connect — get all species allowed in a country, let
users deselect ones not present at their site, then zero out excluded species
from the softmax and re-normalize.

**Problem**: This doesn't solve the mixed-taxonomy-level issue. The 432
higher-taxa classes (like `bear family` or `bird`) would still appear in the
softmax, and zeroing out or including them alongside species-level labels creates
ambiguity.

### Taxonomy mapping (the chosen approach)

Dan Morris (SpeciesNet creator) described a mapping approach he uses in
practice. Instead of working with all 2,498 raw classes, you define a short CSV
(typically 20-30 rows) that maps SpeciesNet taxa to your desired output labels.
The taxonomy hierarchy does the heavy lifting.

**Tools:**

- `restrict_to_taxa_list` function in the megadetector-utils package:
  <https://megadetector.readthedocs.io/en/latest/postprocessing.html#megadetector.postprocessing.classification_postprocessing.restrict_to_taxa_list>
- Taxonomy mapper web tool for generating the initial CSV:
  <https://dmorris.net/speciesnet-taxonomy-mapper/>
- Source for the mapper tool:
  <https://github.com/agentmorris/speciesnet-taxonomy-mapper>

## The Solution: Taxonomy Mapping

### How it works

You create a CSV with columns `latin,common` (and optionally
`original_latin,original_common`). Each row maps a taxon (at any level) to an
output label. For example:

```csv
latin,common
ursus americanus,black bear
ursus arctos,grizzly bear
odocoileus hemionus,mule deer
cervidae,other deer
aves,bird
```

When `restrict_to_taxa_list` processes a SpeciesNet prediction, it walks **up**
the taxonomy tree from the predicted taxon until it finds a match in the CSV:

- `common blackbird` (turdus merula) -> turdus -> turdidae -> passeriformes ->
  aves -> **bird**
- `american black bear` (ursus americanus) -> **black bear** (direct match)
- `bear family` (ursidae) -> carnivora -> mammalia -> **animal** (no match, falls
  through to default)
- `brown bear` (ursus arctos) -> **grizzly bear** (direct match)

Anything that walks all the way up without a match becomes **animal** (the
default catch-all).

### Why this works for AddaxAI-Connect

1. **Single truth per label**: Every prediction maps to exactly one output label
   from a known, fixed set. No ambiguity about what "bear" means.
2. **Short, manageable mappings**: A typical project needs 20-30 rows, not
   2,000+. The hierarchy collapses everything else automatically.
3. **Flexible granularity per project**: One project might distinguish `black
   bear` vs `grizzly bear`. Another might just want `bear`. One CSV row
   difference.
4. **Notifications just work**: User subscribes to "bird" — every bird species
   and every higher bird taxon maps to "bird". No missed alerts, no false
   matches.
5. **Plotting and dashboards just work**: Fixed label set means consistent
   categories across time.
6. **Maintained by SpeciesNet team**: The `restrict_to_taxa_list` function and
   the taxonomy mapper tool are maintained upstream. We use their logic rather
   than reimplementing taxonomy traversal.

### Limitations and considerations

- **Mapping must be created per project region/use case**: There is no universal
  mapping. The taxonomy mapper web tool helps generate a starting point, but
  users may need to tweak it. This replaces the current `included_species`
  multi-select with something slightly more complex.
- **Family-level classifier outputs can be lost**: If `bear family` (ursidae) is
  not in the mapping and no ancestor is either, it falls through to `animal`
  even though it was clearly a bear. Users should map at the family level if
  they care about catching uncertain predictions (e.g., add `ursidae,bear` as a
  row).
- **Mapping is applied post-prediction**: The mapping happens after SpeciesNet
  runs, not during inference. This means you still run the full ensemble
  (detection + classification + ensemble logic), then remap the output.
- **The geofence question is sidestepped**: If grizzly bears are not in your
  region, simply don't include them in the mapping. No need to separately
  configure geofencing — the mapping implicitly defines what's relevant.
  However, running SpeciesNet with geofencing enabled is still recommended as
  it improves raw prediction quality before the mapping is applied.

## Integration Plan for AddaxAI-Connect

### Overview

Replace the current flat `included_species` list with a per-project taxonomy
mapping CSV. The classification service applies this mapping after SpeciesNet
inference to produce a fixed label set per project.

### Data model changes

- Add a `taxonomy_mapping` field to the project model (or a related table) to
  store the CSV content or a reference to a stored file. This replaces or
  augments `included_species`.
- The mapped output labels (the `common` column from the CSV) become the
  project's effective species list for notifications, plotting, and filtering.

### Classification service changes

- Run SpeciesNet inference (detection + classification + ensemble) as normal,
  with geofencing enabled using the project's country/region.
- After getting the SpeciesNet prediction, apply the taxonomy mapping using
  `restrict_to_taxa_list` (from megadetector-utils) or equivalent logic to
  collapse the prediction to the project's label set.
- Store the mapped label and confidence in the classifications table.

### Frontend changes

- Replace the hardcoded DeepFaune species multi-select with a taxonomy mapping
  editor. This could be:
  - A CSV upload interface.
  - An integration with the taxonomy mapper web tool
    (<https://dmorris.net/speciesnet-taxonomy-mapper/>) where users generate a
    CSV, then upload it.
  - A simplified UI that lets users pick species/taxa from a searchable list and
    assign display names.
- The notification species picker and dashboard filters would use the mapped
  label set (the `common` column values) instead of the hardcoded species list.

### Notification and dashboard changes

- Minimal changes needed. The mapped labels are flat strings, just like
  DeepFaune labels. The existing notification rule engine (`notify_species`
  matching) and dashboard grouping work as-is, just against the new label set.

### Updating the mapping mid-project

A key advantage of the taxonomy mapping approach is that it can be updated at
any time without re-running model inference. This requires one architectural
decision: **store the raw SpeciesNet prediction alongside the mapped label.**

Suggested schema:

```
classifications table:
  raw_prediction    ← full SpeciesNet label, immutable once written
  raw_confidence    ← SpeciesNet ensemble confidence, immutable once written
  species           ← mapped label from taxonomy CSV, re-computable
  confidence        ← passed through from raw_confidence, re-computable
```

#### Adding a species

A species not in the mapping shows up unexpectedly (e.g., golden jackal
expanding its range into your study area). Old images of golden jackals would
have been mapped to whatever ancestor matched — likely "canid" or "animal".

To fix this:

1. User adds `canis aureus,golden jackal` to the mapping CSV.
2. Backend re-applies the updated mapping to all `raw_prediction` values for the
   project.
3. Historical records where `raw_prediction` was `canis aureus` (or any
   subspecies) get their `species` column updated from "canid" to "golden
   jackal".
4. This is a bulk SQL update with a lookup table — fast and non-destructive. No
   model re-inference needed.
5. Notifications going forward use the new label.

#### Removing a species

Turns out there are no grizzlies at the site, only black bears. Every "grizzly
bear" prediction was probably a misclassified black bear.

1. User removes the `ursus arctos,grizzly bear` row from the mapping.
2. Backend re-applies the mapping. Former "grizzly bear" records now walk up the
   taxonomy: ursus arctos -> ursus -> ursidae -> ... and land on whatever
   ancestor is still in the mapping (e.g., "bear" if ursidae is mapped, or
   "animal" if not).
3. Same bulk update, same speed, same non-destructiveness.

#### Confidence scores during remapping

When remapping, the confidence score passes through unchanged from the raw
SpeciesNet ensemble prediction. If SpeciesNet said "grizzly bear, 0.82" and the
mapping collapses that to "bear", the output is "bear, 0.82". This is
reasonable — the model was 82% confident about something that is indeed a bear.

This differs from the current DeepFaune normalization (which redistributes
softmax probabilities across included species). Here the mapping happens after
the ensemble has already made its single-label decision, so there is no
redistribution — just relabeling.

#### Implementation notes

- Re-mapping should be triggered whenever the taxonomy CSV is updated, covering
  all existing classifications for that project.
- The re-mapping operation is cheap: iterate all classifications for the
  project, apply the walk-up logic to each `raw_prediction`, and update the
  `species` column. This can be done in a single background task.
- Consider logging or notifying the user about how many records changed during a
  re-mapping, so they have visibility into the impact.

### Migration path

- DeepFaune projects can continue to use the existing `included_species`
  approach since DeepFaune already has a flat label set.
- SpeciesNet projects would use the taxonomy mapping approach.
- The classification service would branch based on which model is configured for
  the project.
