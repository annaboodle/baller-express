import { createRuntimeApp } from "./runtime.js";

const app = createRuntimeApp();

export default {
  fetch(request, env, executionContext) {
    return app.fetch(request, env, executionContext);
  },
};
