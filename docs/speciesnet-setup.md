# SpeciesNet setup

<img width="1624" height="966" alt="Screenshot 2026-03-25 at 13 26 30" src="https://github.com/user-attachments/assets/46a83891-5f3e-41a6-a6eb-b171bfb90e6a" />

This guide walks you through the SpeciesNet-specific settings. The general server settings (timezone, etc.) are covered in the [deployment guide](deployment.md).

## Country

Go to **Server settings** and select the country where your cameras are deployed. This filters out species that don't occur in your region, which improves classification accuracy.

<img width="1624" height="966" alt="Screenshot 2026-03-25 at 13 28 50" src="https://github.com/user-attachments/assets/e890724e-c964-4750-b1fe-48c2f734046f" />

If you select the USA, an optional state dropdown appears to narrow it further.

This only applies to new classifications, not retroactively.

## Taxonomy mapping

SpeciesNet classifies at different taxonomy levels depending on confidence, from species all the way up to class. A taxonomy mapping CSV makes these predictions easier to interpret by letting you control which labels show up in your dashboard, notifications, and exports. You define the labels that make sense for your project, and the system maps every prediction to the best match.

### Creating your CSV

Use the [SpeciesNet Taxonomy Mapper](https://dmorris.net/speciesnet-taxonomy-mapper/) to generate your CSV. This tool was built by Dan Morris, one of the creators of SpeciesNet.

<img width="1624" height="966" alt="Screenshot 2026-03-25 at 13 31 34" src="https://github.com/user-attachments/assets/2d36abd3-6af6-4c7c-86fd-72789f59c1ca" />

#### Step 1: add your study area (optional)

Enter a geographic location in the study area field. This helps the tool resolve ambiguous common names. For example, "badger" refers to different species in Europe vs North America.

#### Step 2: enter your species list

Type or paste your target species into the input field, one per line. You can use common names, latin names, or both (e.g. "red fox, vulpes vulpes"). These are the species and taxonomic groups you expect in your project area.

For most projects, you do not need to list every possible species. SpeciesNet covers thousands of species, and most of them won't show up on your cameras. Family-level groups keep your dashboard clean and avoid showing low-confidence species-level guesses. Start with family-level groups (like "cervidae", "canidae", "felidae") and only add individual species for the ones you actually want to distinguish.

#### Step 3: process and review

Click **Process input**. The tool maps your species list to standardised taxonomy entries. Review the results in the output table:

<img width="1624" height="966" alt="Screenshot 2026-03-25 at 13 40 29" src="https://github.com/user-attachments/assets/796cdafb-5d9a-4b1a-8015-a523ae311c48" />

Edit any rows that look wrong. In this example, the tool mapped "cervidae" to "cervidae family", "felidae" to "cat family" and "panthera leo" to "lion". Review all labels carefully, because they're what you'll see in your dashboard. You can edit them directly in the output table before downloading. For example, you might want to change "cat family" to "other cat", since you have specific species like lion and leopard alongside them. 

#### Step 4: download the CSV

Click **Download CSV**. The file will have four columns: `latin`, `common`, `original_latin`, `original_common`. AddaxAI Connect only uses the `latin` and `common` columns. The other two are ignored on upload.

### Uploading the CSV

1. Log in as a server admin
2. Open the hamburger menu (top right) and click **Server settings**
3. Drag and drop your CSV file at the **Taxonomy mapping** field, or click to browse
4. Click the **Save and reprocess** button that appears
5. after processing, a **View current mapping** link appears in the caption, click to check all went well

<img width="1624" height="966" alt="Screenshot 2026-03-25 at 13 48 33" src="https://github.com/user-attachments/assets/98972879-f630-4d3a-a69e-b2cf78fcdad3" />

The upload replaces any existing mapping. All existing classifications are automatically reprocessed with the new mapping, so you do not need to re-run inference. The response shows how many classifications were updated.

Classification won't start until a taxonomy mapping has been uploaded, so make sure to do this before expecting results.

### Choosing your labels

The labels in your CSV are exactly what you'll see in your dashboard, notifications, and exports. You can re-upload at any time, so don't overthink it on the first try. Start simple and refine as you learn what your cameras are picking up.

**Start broad, then refine.** Begin with family-level groups and only add individual species for the ones you actually want to distinguish. For example, start with `cervidae,other deer` as your only deer entry. If you later want to split out white-tailed deer, add `odocoileus virginianus,white-tailed deer`. Everything else in the deer family still shows up as "other deer".

**Name your catch-alls clearly.** If you have both "white-tailed deer" (species level) and "deer" (family level) in your CSV, it gets confusing fast. A dashboard showing "white-tailed deer" next to "deer" doesn't tell you whether "deer" means "we detected a deer but couldn't tell which kind" or "this is a different deer species". Use "other deer" or "unknown deer" for the family-level catch-all instead. Same goes for any group where you distinguish specific species: "other canid", "other mustelid", etc.

**Always include broad catch-alls.** Without them, any animal that doesn't match a more specific row falls through to the generic label "animal". At minimum, include:

```
mammalia,mammal
aves,bird
reptilia,reptile
```

Even if birds aren't your focus, they show up on camera traps often. Better to label them "bird" than "animal".

### How matching works

SpeciesNet predictions can land at any taxonomy level depending on confidence. The same animal might come back as "red fox" (species), "vulpes" (genus), "canidae" (family), or "carnivora" (order). The system handles this by checking your CSV from the most specific level up to the least specific, and returning the first match. If nothing matches, it falls back to "animal".

Say your CSV contains these two rows:

| Latin | Common |
|---|---|
| `turdus merula` | blackbird |
| `aves` | bird |

SpeciesNet predicts a common blackbird. The system checks for a match at each level:

| Level | Checks for | Match? | Result |
|---|---|---|---|
| Species | `turdus merula` | Yes | **blackbird** |

It matched at species level, so the image is labelled "blackbird". Now say SpeciesNet predicts a great tit, which isn't in your CSV:

| Level | Checks for | Match? | Result |
|---|---|---|---|
| Species | `parus major` | No | |
| Genus | `parus` | No | |
| Family | `paridae` | No | |
| Order | `passeriformes` | No | |
| Class | `aves` | Yes | **bird** |

No specific match, so it walks up to class level and falls back to "bird". If you later want to distinguish great tits, add `parus major,great tit` to your CSV and re-upload. Blackbirds stay "blackbird", great tits become "great tit", and everything else still falls back to "bird".
