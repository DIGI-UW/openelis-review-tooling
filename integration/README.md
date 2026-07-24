# Add the review overlay to an existing deployment

Three ways, depending on what you control. All of them point at the central
authoring service — **nothing is built, vendored, or redeployed on your side**, and
checklist edits show up without touching the integration again.

Two URLs are all you need:

| | |
|---|---|
| the widget | `https://grist.openelis-global.org/oe-review-widget.js` |
| your checklist | `https://grist.openelis-global.org/uat/<instance>.json` |

`<instance>` is the slug of a checklist in the central Grist doc (e.g. `amr`).
Create one before you integrate — see [`../docs/TUTORIAL.md`](../docs/TUTORIAL.md).

---

## 1. You can edit the app's HTML → one script tag

Add to the page template, before `</head>`:

```html
<script src="https://grist.openelis-global.org/oe-review-widget.js"
        data-instance="my-feature"
        data-label="My Feature (OGC-1234)"
        data-src="https://grist.openelis-global.org/uat/my-feature.json"></script>
```

## 2. You control the proxy, not the app → nginx snippet (no app change)

The usual case for an existing deployment: inject it at the reverse proxy. Add to
the `location` block that serves the app's HTML:

```nginx
# Inject the review overlay into HTML responses.
proxy_set_header Accept-Encoding "";   # so nginx sees uncompressed HTML to patch
sub_filter_once on;
sub_filter '</head>' '<script src="https://grist.openelis-global.org/oe-review-widget.js" data-instance="my-feature" data-label="My Feature (OGC-1234)" data-src="https://grist.openelis-global.org/uat/my-feature.json"></script></head>';
```

Reload nginx (`nginx -s reload`) — that's the whole integration. Requires the
`ngx_http_sub_module` (present in the stock nginx image and most distro builds;
check with `nginx -V 2>&1 | grep -o with-http_sub_module`).

<details>
<summary>Apache equivalent</summary>

```apache
# needs mod_substitute + mod_filter
AddOutputFilterByType SUBSTITUTE text/html
Substitute 's|</head>|<script src="https://grist.openelis-global.org/oe-review-widget.js" data-instance="my-feature" data-src="https://grist.openelis-global.org/uat/my-feature.json"></script></head>|q'
```
</details>

## 3. You control neither → bookmarklet (ad-hoc, per reviewer)

For a one-off review of a site you can't configure. Save as a bookmark and click it
on any page — the overlay loads for that tab only:

```
javascript:(function(){var s=document.createElement('script');s.src='https://grist.openelis-global.org/oe-review-widget.js';s.setAttribute('data-instance','my-feature');s.setAttribute('data-label','My Feature');s.setAttribute('data-src','https://grist.openelis-global.org/uat/my-feature.json');document.body.appendChild(s);})();
```

(Sites with a strict `script-src` Content-Security-Policy will block this; use
option 1 or 2 there.)

---

## No backend at all?

The widget doesn't require the central service either — embed the checklist inline
and it runs fully standalone. See [`../widget/README.md`](../widget/README.md).

## Notes

- The checklist endpoint is **public and read-only** (`Access-Control-Allow-Origin: *`);
  authoring requires auth. Don't put anything sensitive in a checklist.
- Reviewer answers live in the reviewer's own `localStorage`, keyed by
  `data-instance` — nothing is sent anywhere until they download their report.
- Use a distinct `data-instance` per feature/ticket so answers and reports don't mix.
