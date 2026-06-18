# Ikramullah Khan Website

This is a GitHub Pages-ready dynamic portfolio website. The page layout is in `index.html`, styling is in `assets/css/styles.css`, app behavior is in `assets/js/site.js`, and all editable profile content is in `assets/data/site-data.json`.

## Update Content

Edit `assets/data/site-data.json` to update:

- Biography, education, research interests, and languages
- Publications, filters, links, status badges, and sorting data
- Software/projects, contact cards, profile links, and footer socials
- Hero text, calls to action, and slideshow images
- Certificates shown in the certificate gallery

## Add Certificates

Put certificate PDFs/images in `assets/certificates/`, then add entries under `certificates.items` in `assets/data/site-data.json`.

Example:

```json
{
  "title": "Certificate Title",
  "issuer": "Issuing Organization",
  "date": "2026",
  "description": "Short certificate description.",
  "file": "assets/certificates/certificate.pdf",
  "thumbnail": "assets/certificates/certificate.jpg"
}
```

## Sync Publications

Publications are synced from Ciencia Vitae and ORCID by GitHub Actions every Sunday at 06:00 UTC. The workflow can also be run manually from the GitHub Actions tab.

The sync sources are:

```text
https://www.cienciavitae.pt//F712-C83E-0XXX
https://orcid.org/0000-0003-0001-1XXX
```

The sync updates only `publications.items` in `assets/data/site-data.json`; manual website content outside publications is not changed.

## Run Locally

Because the site loads JSON dynamically, run it through a local server:

```powershell
python -m http.server 8000
```

Then open `http://localhost:8000`.

## Deploy

Push these files to the repository and enable GitHub Pages from the repository settings. The relative asset paths work under the `/ikramullahkhan/` GitHub Pages path.
