# SpeciesNet setup

If you deployed with SpeciesNet, you'll see some extra warnings on your dashboard after first login:

[add screenshot of the SpeciesNet warnings]

This guide walks you through the SpeciesNet-specific settings. The general server settings (timezone, etc.) are covered in the [deployment guide](deployment.md).

## Country

Go to **Server settings** and select the country where your cameras are deployed. This filters out species that don't occur in your region, which improves classification accuracy.

If you select the USA, an optional state dropdown appears to narrow it further.

[add screenshot of the country setting]

This only applies to new classifications, not retroactively.

## Taxonomy mapping

SpeciesNet classifies at different taxonomy levels depending on confidence, from species all the way up to class. A taxonomy mapping CSV makes these predictions easier to interpret by letting you control which labels show up in your dashboard, notifications, and exports. You define the labels that make sense for your project, and the system maps every prediction to the best match.

### Creating your CSV

Use the [SpeciesNet Taxonomy Mapper](https://dmorris.net/speciesnet-taxonomy-mapper/) to generate your CSV. This tool was built by Dan Morris, one of the creators of SpeciesNet.

[add screenshot of the Taxonomy Mapper tool]

#### Step 1: enter your species list

Type or paste your target species into the input field, one per line. You can use common names, latin names, or both (e.g. "red fox, vulpes vulpes"). These are the species and taxonomic groups you expect in your project area.

For most projects, you do not need to list every possible species. Start with family-level groups (like "cervidae", "canidae", "felidae") and add specific species only for the ones you want to distinguish.

#### Step 2: add your study area (optional)

Enter a geographic location in the study area field. This helps the tool resolve ambiguous common names. For example, "badger" refers to different species in Europe vs North America.

#### Step 3: process and review

Click **Process input**. The tool maps your species list to standardised taxonomy entries. Review the results in the output table:

- Edit any rows that look wrong
- Lock rows you are happy with (click the lock icon)
- Click **Process input** again to reprocess only the unlocked rows

#### Step 4: download the CSV

Click **Download CSV**. The file will have four columns: `latin`, `common`, `original_latin`, `original_common`. AddaxAI Connect only uses the `latin` and `common` columns. The other two are ignored on upload.

### Uploading the CSV

1. Log in as a server admin
2. Open the hamburger menu (top right) and click **Taxonomy mapping**
3. Drag and drop your CSV file, or click to browse

[add screenshot of the taxonomy mapping upload page]

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

Even if birds and reptiles aren't your focus, they show up on camera traps regularly. Better to label them "bird" than "animal".

[add screenshot of labels in the dashboard/gallery]

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
