import express from "express";
import * as cheerio from "cheerio";

const app = express();
const PORT = process.env.PORT || 3000;

const DCC_URL = "https://www.cannabis.ca.gov/licensees/cannaconnect-compliance-hub/";

async function fetchHTML(url) {
  const res = await fetch(url, {
    headers: { "user-agent": "dcc-cannaconnect-action/1.0" }
  });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  return await res.text();
}

/**
 * Parse the "Latest updates" section.
 * On the page, "Latest updates" is followed by a list of items:
 *  - a heading link (### <a>Title</a>)
 *  - a short description paragraph
 *  - a CTA link ("View..." / "Learn more...") :contentReference[oaicite:2]{index=2}
 */
function parseLatestUpdates(html) {
  const $ = cheerio.load(html);

  // Locate the H2 "Latest updates"
  const latestH2 = $("h2").filter((_, el) => $(el).text().trim() === "Latest updates").first();
  if (!latestH2.length) return [];

  // The items appear as list bullets after the H2.
  // We’ll collect the first several H3s after the H2 until the next H2 ("Quick actions"). :contentReference[oaicite:3]{index=3}
  const results = [];

  let node = latestH2.parent();
  // Walk forward in the DOM from the H2 element’s parent container
  // and stop when we hit another H2 section.
  const sectionNodes = [];
  let cur = latestH2.next();
  while (cur.length) {
    if (cur.is("h2")) break;
    sectionNodes.push(cur);
    cur = cur.next();
  }

  // Build a temporary container from these nodes and find the update items.
  const container = $("<div></div>");
  for (const n of sectionNodes) container.append(n.clone());

  // Each update title is an H3 with a link.
  container.find("h3").each((_, h3) => {
    const a = $(h3).find("a[href]").first();
    if (!a.length) return;

    const title = a.text().replace(/\s+/g, " ").trim();
    const url = a.attr("href");

    // Description is typically the next text node/paragraph after the H3. :contentReference[oaicite:4]{index=4}
    let desc = "";
    const next = $(h3).next();
    if (next && next.text) {
      desc = next.text().replace(/\s+/g, " ").trim();
    }

    // Optional CTA link appears shortly after ("View..." / "Learn more...") :contentReference[oaicite:5]{index=5}
    let ctaText = null;
    let ctaUrl = null;
    const cta = $(h3).parent().find('a[href]').filter((__, link) => {
      const t = $(link).text().toLowerCase();
      return t.includes("view") || t.includes("learn more");
    }).first();

    if (cta.length) {
      ctaText = cta.text().replace(/\s+/g, " ").trim();
      ctaUrl = cta.attr("href");
    }

    results.push({
      title,
      url,
      description: desc || null,
      cta_text: ctaText,
      cta_url: ctaUrl,
      source_page: DCC_URL
    });
  });

  // De-dupe by title+url
  const seen = new Set();
  return results.filter((x) => {
    const k = `${x.title}||${x.url}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

app.get("/dcc/cannaconnect/latest", async (req, res) => {
  try {
    const html = await fetchHTML(DCC_URL);
    const latest = parseLatestUpdates(html);
    res.json({ source: DCC_URL, count: latest.length, latest_updates: latest });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Listening on ${PORT}`));
