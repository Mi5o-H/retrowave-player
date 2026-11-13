# Family music sync

Local import, playback, EQ and the existing IndexedDB database remain in place.
Family MP3s are downloaded into that same library and play from local Blob URLs.
No cloud access is needed to play saved audio. Refresh does not remove local tracks.

## Deploy the Worker first

1. Back up the working Cloudflare Worker deployment.
2. Replace worker.js on retrowave-family-sync with cloudflare/worker.js (version 1.1.0).
   Keep wrangler.jsonc and the four working secrets unchanged.
3. Add a new Secret named FAMILY_SYNC_KEY: at least 32 password-manager-generated
   random characters, different from ADMIN_SETUP_KEY. Save/deploy.
   Share only this read-only family key privately with intended family members.
   Never put any real key or token in this repository, chat, URL or screenshot.
4. The allowed player origin defaults to https://mi5o-h.github.io. For a custom
   player domain, set PLAYER_ORIGIN to its exact HTTPS origin (no path/trailing slash).
5. /health should show version 1.1.0. Existing /admin/library remains available.
   No Dropbox reauthorization or refresh-token replacement is needed.

The family key grants access to the MP3 folder and its downloads only. It cannot
perform admin setup or reveal Dropbox tokens. Each download requires both family
Authorization and a short-lived encrypted ticket for a direct MP3 child of the
music folder. Dropbox credentials stay on the Worker. Family API responses are
no-store and only the configured player origin receives CORS permission.
Rotate FAMILY_SYNC_KEY to revoke future family requests. Already-downloaded audio
remains on devices. This is a shared family key, not individual user accounts.

## Publish and verify the player

After the Worker setup, merge the player change and let the existing GitHub Pages
publication finish. Open the player online, close/reopen it once if an older app
shell is still displayed, and confirm v2.0 / FAMILY.

1. Before syncing, play an existing imported track and check skins, EQ, seek,
   next/previous, shuffle/repeat and import still work.
2. Expand FAMILY MUSIC, enter FAMILY_SYNC_KEY (never ADMIN_SETUP_KEY), and Connect.
   Expect 12 MP3 files for the current folder.
3. Download one track. Confirm it appears in the normal library and plays.
4. Choose DOWNLOAD ALL. Completed tracks are preserved if a later download fails;
   retrying skips revisions already saved. CANCEL stops pending requests.
5. Refresh again: there should be no duplicated cloud tracks.
6. Optional: enable automatic downloads. New and updated tracks download when
   connecting or pressing REFRESH LIBRARY while the app is open. This is not
   scheduled background synchronization.
7. In the installed iPhone/iPad Home Screen app, download music while online.
   Then enable airplane mode, close/reopen the app, and play/seek/advance through
   downloaded tracks. Test both devices separately; each has its own storage.
8. Delete one local family track, then download it again. Deleting it locally
   never deletes the Dropbox original. Removed Dropbox files stay on the device.

The family key is held only in memory and is cleared by Disconnect or a page reload.
The user must reconnect for future refreshes, but offline playback needs no key.
Maximum individual download: 100 MB. Free device storage if a save fails. The app
requests persistent storage where supported, but iOS can still remove site data.
Keep original backups. Background/lock-screen playback and background downloads
are not guaranteed. Do not clear website storage to update the app.

## Validation

From this repository directory (Node 24 used):

    node tests/oauth.mjs
    node tests/family-worker.mjs
    node tests/player.mjs
    node tests/service-worker.mjs

These use simulated Dropbox responses and browser storage/DOM interfaces, not
live credentials. They verify OAuth behavior, origin/auth restrictions, folder-
bound expiring tickets, Unicode headers, download bodies, duplicate prevention,
revision updates, failure preservation, selection stability and offline-shell
fallback. They do not replace actual Cloudflare, Safari or iOS playback tests.

## Rollback

Restore index.html and sw.js from commit 6a39bfbb498827efb149826d0a9b86be21c347ac,
but use a fresh service-worker cache name so existing devices receive the rollback.
Keep the same IndexedDB database; downloaded tracks remain normal playable blobs.
Restore the prior Cloudflare deployment separately if necessary. Do not delete
secrets or device storage during a rollback.

Favorites: tap the heart beside any saved track. Favorites appear first and persist on this device, including after a cloud revision update. Unfavorite to return to normal order. Run node tests/favorites.mjs for the four favorite checks.
