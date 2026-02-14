**Repo conventions:**
1. **Crash early and loudly** - Fail hard in development so bugs cannot hide. Never allow silent failures.
2. **Explicit configuration** - No defaults. If something is missing, stop and surface it immediately.
3. **Type hints everywhere** - Make expectations clear and support safe refactoring.
4. **Short and clear documentation** - Keep explanations concise without losing clarity.
5. **Open source friendly** - Never commit secrets or anything that should not be public.
6. **No backward compatibility** - The project is in motion and has no users. Refactor freely when needed.
7. **Prefer simple solutions** - Use straightforward approaches that follow the conventions. Avoid cleverness when simplicity works.
8. **Follow the established conventions** - Keep structure predictable so the codebase stays readable and easy to maintain. 
9. **No quick fixes** - Fix issues in a way that holds for all future deployments, not only the current device.
10. **Clean repo** - Value simplicity and cleanliness. No redundant MD files. 
11. **No title case** - Use natural English capitalisation. That means only capitalising the first word of sentences, headings, and proper nouns (like "Peter van Lunteren", "Utrecht", "MegaDetector", "SpeciesNet", "Today, I was walking in the park.",  "Things I love about Amsterdam.", "Cities visited"). Do capitalize the first letter of headers (e.g., "Detections per 100 trap-days", "Species selection"). 
12. **Use git to move files** - Don't ever use rsync to put scripts on servers. Always use git commit, git push, and git pull on the server itself. That keeps the code up to date. 
13. **Use built in features if possible** - Always check whether the required functionality is already available through built-in features. If so, prefer that over writing custom code. If a built-in option is close but does not fully meet the requirement, stop and discuss the pros and cons before proceeding.