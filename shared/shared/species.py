"""
Classification model species constants.

Single source of truth for species labels per model.
Workers and the API import from here instead of defining their own lists.
"""

# DeepFaune v1.4 species classes (38 European wildlife species)
# Order MUST match the model's training output
DEEPFAUNE_CLASSES = [
    "bison", "badger", "ibex", "beaver", "red_deer", "golden_jackal", "chamois",
    "cat", "goat", "roe_deer", "dog", "raccoon_dog", "fallow_deer", "squirrel",
    "moose", "equid", "genet", "wolverine", "hedgehog", "lagomorph", "wolf",
    "otter", "lynx", "marmot", "micromammal", "mouflon", "sheep", "mustelid",
    "bird", "bear", "porcupine", "nutria", "muskrat", "raccoon", "fox",
    "reindeer", "wild_boar", "cow"
]

# Alphabetically sorted for user-facing display
DEEPFAUNE_SPECIES = sorted(DEEPFAUNE_CLASSES)
