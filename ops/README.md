# Russian application-download mirror

Public entry point: https://download.subvost.fun/

This is a static copy on RU-MOW (185.75.249.181), **not VK CDN**. It does not
proxy arbitrary URLs, subscriptions, or VPN traffic. GitHub Releases remains
the canonical publisher and primary download; Russia is an explicit secondary
option for slow GitHub downloads on both selectors. Existing application update
feeds are deliberately unchanged: old Windows/Android clients restrict asset
hosts to GitHub, and macOS appcasts are signed independently of their DMGs.

## Files and publication

- `/var/www/subvost-downloads/`: page, catalogue, verified manifest, release files.
- `/var/www/subvost-downloads/.staging/`: private, HTTP-inaccessible file staging.
- `/var/lib/subvost-download-mirror/`: lock and last-success receipt.
- `/opt/subvost-download-mirror/sync-mirror.py`: deployed synchronizer.
- `subvost-download-mirror.service` / `.timer`: unprivileged, hourly sync.
- `/etc/nginx/sites-available/subvost-downloads`: isolated HTTPS virtual host.
- `/etc/nginx/ssl/subvost-download/`: certificate installed/renewed by acme.sh.

The synchronizer selects the newest release for each supported installer slot,
not the GitHub global `latest` flag. It also copies checksums and corresponding
source archives from those release tags. Every file requires the exact official
repository URL, size, and upstream SHA-256. Two bounded downloads at a time,
atomic publication, failed-download cleanup, process lock, 12 GiB total mirror
ceiling, 4 GiB current-set ceiling, and 8 GiB free-disk reserve prevent a failed
refresh from consuming the disk or publishing partial files. Old files are not
automatically deleted or overwritten. A storage-limit failure retains the last
working catalogue and is visible in the service journal.

Manual refresh / inspection:

```sh
systemctl start subvost-download-mirror.service
systemctl status subvost-download-mirror.service
journalctl -u subvost-download-mirror.service -n 50
cat /var/lib/subvost-download-mirror/last-success.json
systemctl list-timers subvost-download-mirror.timer
```

The timer refreshes **release files and catalogue**, not executable scripts or
website source. Website changes are deployed separately from this repository's
`docs/`, excluding `catalog.json`, `tests/`, and `updates/`. Preserve the mirror's
generated catalogue. This separation prevents an unreviewed upstream script
from executing on the server. Legacy update feeds should not be rewritten to
the mirror until a client release explicitly trusts its exact host/path.

The RU node's existing conservative TCP/443 traffic guard remains unchanged.
Direct downloads are not billed as VK CDN traffic, but consume RU node traffic
and count toward that shared guard; a guard cutoff or RU outage can affect the
mirror. The GitHub download alternative remains available on the main page.

## Verification and rollback

Run `node --test docs/tests/*.test.mjs` and
`python3 -m unittest discover -s ops -p 'test_*.py' -v` before deployment. Verify
HTTPS, CORS on manifest, JS MIME type, HEAD/Content-Length, HTTP Range (206),
full SHA-256, platform selection and mirror-unavailable fallback.

To stop refreshing, disable the mirror timer; this leaves already downloaded
files online. To roll back website links, revert the mirror UI commit and
redeploy. Do not delete the release directory as a rollback operation. No
existing subscription, geodata, CDN, or VPN virtual host is changed by this
mirror deployment.
