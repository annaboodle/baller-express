import { createSubmissionApp } from "./app.js";

const app = createSubmissionApp();

export default {
  fetch(request, env) {
    return app.fetch(request, env);
  },
};
