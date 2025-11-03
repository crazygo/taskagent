# Release Branch Collaboration

This project uses a two-branch cadence to ship npm releases while keeping `main` developer-friendly.

## Branch Roles

- **`main`** – default branch for feature work. All pull requests merge here after review.
- **`release`** – mirrors the state that is ready to ship. Pushing to this branch triggers the automated publish workflow.

## Release Ritual

1. **Stabilise `main`**  
   - Ensure CI is green and the feature set for the release is complete.

2. **Promote to `release`**  
   - `git checkout release && git merge --ff-only main` (or open a PR from `main` to `release`).  
   - Push the merge. This single push triggers `.github/workflows/release-auto-publish.yml`.

3. **Wait for Automation**  
   - The workflow bumps the patch version, rebuilds, publishes to npm, commits the bump, uploads the tarball, and pushes the new tag.  
   - Guard rails prevent the workflow from triggering itself, so wait until it finishes before making further changes.

4. **Synchronise Back to `main`**  
   - Merge the latest `release` back into `main` (fast-forward or PR).  
   - This keeps both branches on the same version number and history.

5. **Tag Notes / Comms**  
   - Announce the release, attach changelog items, and close any tracking issues.

## House Rules

- Do not commit directly to `release` except the automated job. Human changes should always flow through `main`.
- If the workflow fails, fix the cause on `main`, redo the merge, and rerun.
- Rotate the npm token regularly; the workflow reads it from the `copilot` environment (`NPM_TOKEN`).
