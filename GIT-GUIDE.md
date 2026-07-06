# Git guide — starwarsffg

A plain-language reference for using Git with this system. You don't need to
memorize any of it; keep this file open and copy the commands you need.

Everything runs inside your system folder (the one with `system.json`). Open a
terminal there first. On Windows, right-click the folder and choose
"Git Bash Here"; on macOS/Linux, `cd` into it.

---

## What Git is doing for you

Git takes snapshots ("commits") of your files whenever you ask. Every snapshot
is saved forever, so you can always look back or go back. Think of it as an
unlimited, labeled undo history for the whole project — one that never expires
when you close the editor.

You control when snapshots happen. Nothing is sent anywhere unless you set up a
remote (like GitHub) yourself. For now this is all private, on your computer.

---

## One-time setup (run these once)

```bash
git init
git config core.hooksPath hooks     # turns on the auto syntax check
git add -A                           # stage every file for the first snapshot
git commit -m "Initial commit: starwarsffg v2.0.3 (Foundry V13)"
```

If you want the syntax check active (recommended), also install the tools once:

```bash
npm install
```

That reads `package.json` and downloads the developer tools (including acorn,
the syntax checker) into a `node_modules/` folder. That folder is ignored by
Git on purpose, so it never clutters your snapshots.

---

## The everyday loop

You'll use these four constantly. This is 90% of Git.

```bash
git status      # what have I changed? (run this any time — it's always safe)
git add -A      # stage all your changes, getting them ready to snapshot
git commit -m "Fix talent double-application on species sheet"
git log --oneline   # see your history of snapshots, newest first
```

A good commit message says what changed and why, in one line. "Fix vehicle gear
modifier bleed" is better than "update actor-ffg.js".

The syntax check runs automatically inside `git commit`. If you have a
JavaScript typo, the commit stops and shows you the file and line. Fix it and
commit again. (In a true emergency you can skip the check with
`git commit --no-verify`, but you rarely should.)

---

## Undo — the part everyone worries about

Git makes it hard to lose work. Here are the safe ways to back out.

**"I edited a file and want to throw those edits away"** (before committing):
```bash
git restore path/to/file.js       # discard changes to one file
git restore .                     # discard ALL uncommitted changes
```

**"I ran `git add` but want to un-stage"** (the file is kept, just not staged):
```bash
git restore --staged path/to/file.js
```

**"I just committed and want to fix the message or add one more file"**:
```bash
git add the-file-i-forgot.js
git commit --amend -m "Better message"
```

**"What exactly did I change?"**:
```bash
git diff              # unstaged changes
git diff --staged     # changes you've already staged
```

**"I want to go back to how a file looked in an earlier commit"**:
```bash
git log --oneline path/to/file.js     # find the commit ID (e.g. a1b2c3d)
git restore --source a1b2c3d path/to/file.js
```

Reassurance: once something is committed, it's very hard to truly lose. Even
commits you think you deleted usually sit in `git reflog` for weeks. When in
doubt, commit — a snapshot is cheap and always reversible.

---

## A safe habit for risky changes

Before a big or scary change (like a schema/DataModel edit), commit first so you
have a clean point to return to:

```bash
git add -A && git commit -m "Checkpoint before DataModel change"
```

If the change goes wrong, `git restore .` puts you right back.

---

## Later, if you want a backup on GitHub (optional)

This is not required and can wait until you're comfortable. When you're ready,
create an empty repository on GitHub, then:

```bash
git remote add origin <the-url-github-gives-you>
git push -u origin main
```

After that, `git push` uploads your latest commits and `git pull` brings down
any changes. Note: your `system.json` points its manifest at the upstream
project, not your own copy — so push to a repository you create, not upstream.

---

## Quick reference

| I want to...                        | Command                              |
|-------------------------------------|--------------------------------------|
| See what changed                    | `git status`                         |
| Stage everything                    | `git add -A`                         |
| Take a snapshot                     | `git commit -m "message"`            |
| See history                         | `git log --oneline`                  |
| Discard edits to a file             | `git restore path/to/file`           |
| Un-stage a file                     | `git restore --staged path/to/file`  |
| Fix the last commit                 | `git commit --amend`                 |
| See exact changes                   | `git diff`                           |
