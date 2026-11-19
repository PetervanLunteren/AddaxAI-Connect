# SpeciesNet setup

SpeciesNet knows more than 2,000 species, and about 400 groups above them. When it is not sure which species it sees, it names a group instead, so the same wolf can come back as "grey wolf", "canis species", "canine family", "carnivorous mammal" or "mammal". AddaxAI Connect sends alerts and runs rules on labels, and a wolf alert that has to list five names for one animal is hard to set up. It works better with a short, fixed list of labels that you choose yourself. A SpeciesNet project gets that list from a CSV file, which turns every answer of SpeciesNet into one of your labels.

Making that list by hand is hard. Every name must be spelled exactly as in SpeciesNet's own list of 3,500 names, and every row changes what the other rows catch. One row too many or too few and a fox ends up as "mammal", or a wolf alert stays silent. That is why there is the AI taxonomist, an AI assistant that makes the list with you.

![Species labels in the project settings](https://github.com/user-attachments/assets/51091c3a-c234-49a3-92e9-a20eecde4f1c)

## Make the label list

Open an AI assistant that can browse the web, like Claude, ChatGPT or Gemini, and write:

```
Read https://raw.githubusercontent.com/PetervanLunteren/AddaxAI-Connect/main/skills/ai-taxonomist/SKILL.md and follow it.
```

It asks where your cameras are and what the project is about, looks up which animals are recorded there, and proposes a list with broad groups. Ask it for more detail where you need it, or ask it anything about the labels. When you are happy, it gives you the CSV.

## Add the list to a project

When you create a project and pick SpeciesNet, drop the CSV at Species labels. The project is only created when the file is valid. If the file holds a name that SpeciesNet does not know, the dialog lists those rows. Paste that message to the AI taxonomist and it fixes them.

![Create project dialog with SpeciesNet](https://github.com/user-attachments/assets/e256ce0b-349b-4e54-a4df-507c6abebc65)

## Change the list

1. Open the project and go to Settings
2. At Species labels, click "download the CSV"
3. Start the AI taxonomist, say you want to change your list, and paste the file with what you want different. For example wolves, dogs and foxes apart instead of one canid label. It asks what it needs to know and tells you what works best
4. Drop the new CSV at Species labels and click Save changes

The new list replaces the old one, and every detection gets its new label right away, without running the AI again. Verified detections keep their labels.

If the new list drops a label that notifications of users are set on (detection alerts or species reports), a window shows what will be removed before anything is saved. When you confirm, the label is taken out of those notifications, a notification with no label left is deleted, and the users it touches get an email.

## How matching works

The file has two columns. `latin` is a name from SpeciesNet's own list, `common` is the label you see. For every animal the system checks your file from the most specific level to the least (species, genus, family, order, class) and uses the first row it finds.

Say your file holds `vulpes vulpes` as red fox, `canidae` as unknown canid and `mammalia` as mammal:

| SpeciesNet says | First row found | Label |
|---|---|---|
| red fox | `vulpes vulpes` | red fox |
| canine family | `canidae` | unknown canid |
| northern raccoon | `mammalia` | mammal |

A row catches everything at its level and below it, never above. When no row matches, the label is "unknown animal". That label also covers the rare detections where SpeciesNet gave no answer at all.
