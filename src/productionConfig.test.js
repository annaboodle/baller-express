import Papa from "papaparse";
import { loadPublishedTimeline } from "./publishedTimeline";
import { validPublishedFeed, publicFeedMatches, publicFields } from "./productionConfig.mjs";
import { getSubmissionConfig } from "./submissions";

const url = "https://docs.google.com/spreadsheets/d/e/test/pub?gid=123&single=true&output=csv";
const env = {
  REACT_APP_PRODUCTION_WORKER_ORIGIN: "https://baller-submissions-production.example.workers.dev",
  REACT_APP_PRODUCTION_TURNSTILE_SITE_KEY: "public-example",
};

test("production uses only its Worker and published single-tab CSV", () => {
  const origin = "https://ballerexpress.com";
  expect(getSubmissionConfig(env, { origin }).available).toBe(true);
  expect(getSubmissionConfig(env, { origin: "http://localhost:3000" }).available).toBe(false);
  expect(getSubmissionConfig({ ...env, REACT_APP_PRODUCTION_WORKER_ORIGIN: "https://staging.example.workers.dev" }, { origin }).available).toBe(false);
  expect(validPublishedFeed(url)).toBe(true);
  for (const bad of [undefined, url.replace("single=true&", ""), url + "&gid=1", url.replace("docs.google.com", "example.org")]) {
    expect(validPublishedFeed(bad)).toBe(false);
  }
  const display = jest.fn();
  const spy = jest.spyOn(Papa, "parse").mockImplementation((_, options) =>
    options.complete({ data: [{ event_id: "one", date: "1/1/2000", event: "One" }], errors: [], meta: { fields: publicFields } }));
  try {
    loadPublishedTimeline(undefined, display);
    expect(spy).not.toHaveBeenCalled();
    loadPublishedTimeline(url, display);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(display).toHaveBeenCalledTimes(1);
  } finally {
    spy.mockRestore();
  }
});

test("public feed rejects private columns, malformed rows and duplicate IDs", () => {
  const row = { event_id: "one", date: "1/1/2000", event: "One" };
  const result = { data: [row], errors: [], meta: { fields: publicFields } };
  expect(publicFeedMatches(result)).toBe(true);
  expect(publicFeedMatches({ ...result, meta: { fields: [...publicFields, "contributor_email"] } })).toBe(false);
  expect(publicFeedMatches({ ...result, data: [row, row] })).toBe(false);
  expect(publicFeedMatches({ ...result, errors: [{}] })).toBe(false);
});
