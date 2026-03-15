# SpeciesNet taxonomy mapping

## Why you need this

SpeciesNet classifies animals at mixed taxonomy levels. Depending on confidence, the same animal might come back as "red fox" (species), "vulpes" (genus), "canidae" (family), or "carnivora" (order). This is fine for offline research where you review and correct predictions manually, but for a real-time system like AddaxAI Connect it creates problems. Which label do you send in a notification? Which one shows up in your dashboard tables and maps?

Taxonomy mapping solves this by normalising all predictions to a fixed set of labels that you define. You upload a CSV that maps taxonomic groups to human-readable names. A walk-up algorithm then converts every SpeciesNet prediction into one of your labels.

## How the walk-up algorithm works

SpeciesNet predictions contain the full taxonomy hierarchy: `class;order;family;genus;species;common_name`. The algorithm walks from the most specific level (usually `species`) up to the least specific (`class`), and returns the first match it finds in your CSV.

Example: SpeciesNet predicts "common blackbird" with the raw label:

```
aves;passeriformes;turdidae;turdus;merula;common blackbird
```

Walk-up sequence:
1. `turdus merula` (species)
2. `turdus` (genus)
3. `turdidae` (family)
4. `passeriformes` (order)
5. `aves` (class)

If nothing matches at any level, the prediction falls through to "animal". Now say you add `aves,bird` to your CSV. The same prediction walks up to step 5, finds a match, and the blackbird is labelled **bird** in your dashboard and notifications.

If you later want to distinguish blackbirds specifically, add `turdus merula,blackbird` to your CSV. The walk-up now matches at step 1 and returns **blackbird** instead of **bird**. All other bird species still fall through to **bird**.

## Creating your CSV

Use the [SpeciesNet Taxonomy Mapper](https://dmorris.net/speciesnet-taxonomy-mapper/) to generate a CSV. This tool was built by Dan Morris, one of the creators of SpeciesNet.

### Step 1: enter your species list

Type or paste your target species into the input field, one per line. You can use common names, latin names, or both (e.g. "Red fox, Vulpes vulpes"). These are the species and taxonomic groups you expect in your project area.

For most projects, you do not need to list every possible species. Start with family-level groups (like "cervidae", "canidae", "felidae") and only add specific species for the ones you want to distinguish individually. See [continent-specific templates](taxonomy-templates/) for starting points.

### Step 2: add your study area (optional)

Enter a geographic location in the study area field. This helps the tool resolve ambiguous common names. For example, "badger" refers to different species in Europe vs North America.

### Step 3: process and review

Click **Process input**. The tool uses Gemini to map your species list to standardised taxonomy entries. Review the results in the output table:

- Edit any rows that look wrong
- Lock rows you are happy with (click the lock icon)
- Click **Process input** again to reprocess only the unlocked rows

### Step 4: download the CSV

Click **Download CSV**. The file will have four columns: `latin`, `common`, `original_latin`, `original_common`. AddaxAI Connect only uses the `latin` and `common` columns. The other two are ignored on upload.

## Uploading into AddaxAI Connect

1. Log in as a server admin
2. Open the hamburger menu (top right) and click **Taxonomy mapping**
3. Drag and drop your CSV file, or click to browse

The upload replaces any existing mapping. All existing classifications are automatically reprocessed with the new mapping, so you do not need to re-run inference. The response shows how many classifications were updated.

The SpeciesNet worker requires a taxonomy mapping to function. It will wait at startup until a CSV has been uploaded.

## Tips

- Start coarse, then refine. Begin with family-level groups and add specific species later as needed. For example, start with `canidae,canid`, then later add `vulpes,fox` to split foxes out from the rest of the canids.
- Always include `mammalia,mammal` as a catch-all. Without it, any mammal that does not match a more specific row falls through to "animal".
- Include `aves,bird` and `reptilia,reptile` even if birds and reptiles are not your focus. They show up on camera traps and it is better to label them properly than have them appear as "animal".
- Uploading a new CSV is non-destructive. It updates the `species` label on existing classifications but never touches the raw SpeciesNet prediction, which is always preserved.
