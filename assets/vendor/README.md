# DOMPurify

`purify.min.js` is the unmodified browser distribution from the pinned npm package `dompurify@3.4.16`. Its license is retained in `DOMPurify-LICENSE.txt`.

The local copy is intentional: the file-based builder and standalone exports must sanitize branded HTML without a CDN. When upgrading, update the lockfile and local distribution together and run the browser security/export tests. Do not replace the sanitizer with regex filtering.

Upstream documentation: https://github.com/cure53/DOMPurify
