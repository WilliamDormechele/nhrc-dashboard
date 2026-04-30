\---

name: safe-git

description: Checks staged files before commit and prevents secrets from being committed.

\---



\# Safe Git Skill



Before any commit:



1\. Run `git status`

2\. Run `git diff --staged`

3\. Check for:

&#x20;  - API keys

&#x20;  - Firebase keys

&#x20;  - `.env`

&#x20;  - passwords

&#x20;  - private keys

&#x20;  - service account JSON files

4\. Confirm `.gitignore` protects secrets

5\. Suggest a safe commit message



Return:



\## Git status

\## Risk check

\## Files safe to commit

\## Files to unstage

\## Suggested commit command

