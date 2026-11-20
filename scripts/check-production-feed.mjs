import Papa from "papaparse";
import { validPublishedFeed, productionSubmissionConfig, publicFeedMatches } from "../src/productionConfig.mjs";

async function main() {
  const feed = process.env.REACT_APP_PRODUCTION_TIMELINE_CSV;
  if (!validPublishedFeed(feed) || !productionSubmissionConfig(process.env)) {
    throw new Error("Set all three production repository variables before publishing.");
  }
  const response = await fetch(feed, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error("Cannot read the generated tab while signed out.");
  const result = Papa.parse(await response.text(), { header: true, skipEmptyLines: true });
  if (!publicFeedMatches(result)) throw new Error("Unexpected public feed schema or missing milestone IDs.");
  console.log(`Checked ${result.data.length} public rows and the seven public columns.`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
