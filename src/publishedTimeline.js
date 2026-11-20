import Papa from "papaparse";
import { validPublishedFeed, publicFeedMatches } from "./productionConfig.mjs";

export function loadPublishedTimeline(url, display) {
  if (!validPublishedFeed(url)) return;
  Papa.parse(url, {
    header: true,
    download: true,
    skipEmptyLines: true,
    complete(result) {
      if (publicFeedMatches(result)) display(result.data);
    },
  });
}
