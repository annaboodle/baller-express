// Shared by the browser and the manual Pages build.
const publicFields = ["event_id", "date", "precise", "event", "people", "type", "size"];

function validPublishedFeed(value) {
  try {
    const url = new URL(value);
    return url.origin === "https://docs.google.com" &&
      !url.username && !url.password && !url.hash &&
      /^\/spreadsheets\/d\/e\/[a-zA-Z0-9_-]+\/pub$/.test(url.pathname) &&
      url.searchParams.get("output") === "csv" &&
      url.searchParams.get("single") === "true" &&
      /^\d+$/.test(url.searchParams.get("gid")) &&
      [...url.searchParams].length === 3;
  } catch {
    return false;
  }
}

function productionSubmissionConfig(env) {
  const apiOrigin = env.REACT_APP_PRODUCTION_WORKER_ORIGIN;
  const siteKey = env.REACT_APP_PRODUCTION_TURNSTILE_SITE_KEY;
  if (!/^https:\/\/baller-submissions-production\.[a-z0-9-]+\.workers\.dev$/.test(apiOrigin || "") ||
      !/^[a-zA-Z0-9_-]{5,100}$/.test(siteKey || "")) return null;
  return Object.freeze({ available: true, production: true, apiOrigin, siteKey });
}

function publicFeedMatches({ data, errors, meta }) {
  return errors.length === 0 && meta.fields?.join(",") === publicFields.join(",") &&
    data.length > 0 && data.every(row => row.event_id && row.date && row.event) &&
    new Set(data.map(row => row.event_id)).size === data.length;
}

export { publicFields, validPublishedFeed, productionSubmissionConfig, publicFeedMatches };
