# SpeciesNet setup

![Screenshot 2026-03-25 at 13 26 30](https://github.com/user-attachments/assets/46a83891-5f3e-41a6-a6eb-b171bfb90e6a)

This page covers what only applies to SpeciesNet. The general server settings, like the timezone, are in the [deployment guide](deployment.md).

Every SpeciesNet project needs a country and a list of species labels. You give both when you create the project, and you can change them later in the project settings. Each project has its own, so one server can run projects in different countries.

The species labels take three steps:

1. Write a list of the labels you want to see, using the rules below
2. Turn that list into a CSV file with the SpeciesNet Taxonomy Mapper
3. Add the CSV when you create the project

## Country

When you create a project, select the country where its cameras are. SpeciesNet then avoids species that do not occur there. For example, it will not call an animal in the Netherlands a kangaroo.

If you select the USA, an optional state field appears to narrow it further.

You can change the country later in the project settings. A change only applies to new images, not to images that are already processed.

## Why SpeciesNet sometimes names a group

SpeciesNet knows 2,066 species and about 430 broader groups, like "deer family" or "bird". When it is not sure which species it sees, it names a group instead. A red fox it is unsure about can come back as "canid family", or even as "mammal".

The taxonomy mapping turns all of this into your own short list of labels. These labels are what you see in the dashboard, in notifications and in exports. The rules below make sure each label means one clear thing.

## Choosing your labels

Write your list first, one label per line as "latin, common". In the next section you paste it into the mapper. The [AI taxonomist](ai-taxonomist.md) lets an AI assistant do this with you, from the animals recorded near your cameras.

### Groups you care about

List every species of that group that can occur in your area, including domestic and feral animals. Then add the group itself as "unknown ...". For example, when wolves are your target:

```
canis lupus, wolf
canis familiaris, domestic dog
canis aureus, golden jackal
vulpes vulpes, red fox
nyctereutes procyonoides, raccoon dog
canidae, unknown canid
```

"Unknown canid" now only catches canids that SpeciesNet was unsure about. An alert on "unknown canid" is worth a look, because it might be a wolf.

Do not skip the domestic species. If "wolf" is the only *canis* in your list, every dog is folded into "wolf", and you get wolf alerts for dogs.

### Groups you don't care about

One row is enough. Name it plainly, without "unknown" or "other", because the label covers every animal in that group:

```
mustelidae, mustelid
cervidae, deer
```

Also list the neighbouring groups that occur in your area. The mapper widens a row as far as it can without touching another row in your list. If `cervidae, deer` is your only hoofed animal, it becomes all even-toed hoofed animals, and a wild boar shows up as "deer". Adding `suidae, wild boar` keeps deer as deer.

If you care about birds, list the local bird species and add `aves, unknown bird`. If you don't, `aves, bird` is enough.

### Backstops

Always add a row for each animal class, so every animal lands on one of your labels:

```
mammalia, mammal
aves, bird
reptilia, reptile
amphibia, amphibian
```

Leave out a class that is already in your list. An animal that matches no row at all is labelled "unknown animal". That label also covers the rare detections where SpeciesNet gave no answer at all.

You can re-upload at any time. Start simple and refine as you learn what your cameras see.

## Creating your CSV

Use the [SpeciesNet Taxonomy Mapper ↗](https://dmorris.net/speciesnet-taxonomy-mapper/){:target="_blank"} to turn your list into a CSV. This tool was built by Dan Morris, one of the creators of SpeciesNet.

![Screenshot 2026-03-25 at 13 31 34](https://github.com/user-attachments/assets/2d36abd3-6af6-4c7c-86fd-72789f59c1ca)

#### Step 1: add your study area (optional)

Enter a location in the study area field. This helps the tool with common names that mean different animals in different places. For example, "badger" is a different species in Europe than in North America.

#### Step 2: paste your list

Paste the list you wrote in the previous section, one label per line.

#### Step 3: process and review

Click `Process input`. The tool maps every line to a SpeciesNet taxon. Review the results in the output table:

![Screenshot 2026-03-25 at 14 20 15](https://github.com/user-attachments/assets/a7bbde33-95ad-411f-8389-8109645e623e)

Check two things in every row:

- **The common name** is the label you will see. Edit it directly in the table if needed. In this example you would rename "cat family" to "unknown cat", because lion and leopard are listed separately.
- **The latin name** is the level the label applies to. The tool widens every row to the highest level where no other row in your list sits. A species can become its genus, and a family can become its order. Check every widened row. If it now covers animals that need their own label, change the latin name back, or add those animals to your list.

#### Step 4: download the CSV

Click `Download CSV`. The file has four columns: `latin`, `common`, `original_latin`, `original_common`. AddaxAI Connect only uses `latin` and `common`.

#### Step 5: add the CSV to your project

When you create a project, drop the CSV at the `Species labels` field. The project is only created when the CSV is valid.

To change the labels later:

1. Open the project and go to `Settings`
2. Drop the new CSV at `Species labels`, or click to browse
3. Click `Save and relabel`
4. Click `View current labels` to check all went well

The new file replaces the old labels. Images that nobody has verified yet get new labels right away, without running the model again. Verified images keep their labels. If alert rules, species reports or thresholds still use a label that is no longer in the list, the page names it, so you can update them.

## How matching works

For every animal, the system checks your CSV from the most specific level to the least specific, and uses the first match. If nothing matches, the label is "unknown animal".

Say your CSV contains these two rows:

| Latin | Common |
|---|---|
| `turdus merula` | blackbird |
| `aves` | bird |

SpeciesNet predicts a common blackbird:

| Level | Checks for | Match? | Result |
|---|---|---|---|
| Species | `turdus merula` | Yes | **blackbird** |

Now SpeciesNet predicts a great tit, which is not in your CSV:

| Level | Checks for | Match? | Result |
|---|---|---|---|
| Species | `parus major` | No | |
| Genus | `parus` | No | |
| Family | `paridae` | No | |
| Order | `passeriformes` | No | |
| Class | `aves` | Yes | **bird** |

The same happens when SpeciesNet itself names a group. A prediction of "paridae family" starts at the family level and also ends at "bird". To tell great tits apart, add `parus major, great tit` to your CSV and upload it again.
