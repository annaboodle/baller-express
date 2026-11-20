import React from "react";
import { fireEvent, render, wait, within } from "@testing-library/react";
import Papa from "papaparse";
import App from "./App";
import { SubmissionError } from "./submissions";

jest.mock("papaparse", () => ({ parse: jest.fn() }));
jest.mock("stickybits", () => jest.fn());
jest.mock("./components/TurnstileWidget", () => {
  const ReactForMock = require("react");
  return function MockTurnstile({ action, onReady, onToken }) {
    const propsRef = ReactForMock.useRef({ onReady, onToken });
    propsRef.current = { onReady, onToken };
    ReactForMock.useEffect(() => {
      const controller = {
        execute() {
          propsRef.current.onToken(`test-token-${action}`);
        },
        reset() {},
      };
      propsRef.current.onReady(controller);
      return () => propsRef.current.onReady(null);
    }, [action]);
    return <div data-testid={`turnstile-${action}`} />;
  };
});

const TEST_CONFIG = {
  available: true,
  apiOrigin: "https://staging-example.workers.dev",
  siteKey: "test-public-site-key",
};

const MASTER_TIMELINE = [
  {
    event_id: "event-existing-1",
    event: "Alice and Bob met",
    precise: "Y",
    date: "01/02/2020",
    type: "intro",
    size: "m",
    people: "Alice, Bob",
  },
  {
    event: "Bob moved",
    precise: "N",
    date: "02/03/2021",
    type: "move",
    size: "l",
    people: "Bob",
  },
];

const SUBMITTED_MILESTONES = [
  {
    event: "Group trip",
    precise: "Y",
    date: "03/04/2022",
    type: "trip",
    size: "m",
    people: "Alice, Charlie",
    hide: "N",
  },
  {
    event: "Hidden spam",
    precise: "Y",
    date: "05/31/1970",
    type: "trip",
    size: "m",
    people: "Bot",
    hide: "Y",
  },
];

function defaultApi(overrides = {}) {
  return {
    submitMilestone: jest.fn(),
    submitEditProposal: jest.fn(),
    ...overrides,
  };
}

function renderApp(api = defaultApi()) {
  return {
    api,
    ...render(<App submissionConfig={TEST_CONFIG} submissionApi={api} />),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  let uuidCounter = 0;
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: {
      randomUUID: jest.fn(() => {
        uuidCounter += 1;
        return `00000000-0000-4000-8000-${String(uuidCounter).padStart(
          12,
          "0",
        )}`;
      }),
    },
  });
  Object.defineProperty(window, "crypto", {
    configurable: true,
    value: globalThis.crypto,
  });
  let feedIndex = 0;
  Papa.parse.mockImplementation((_url, { complete }) => {
    const feeds = [MASTER_TIMELINE, SUBMITTED_MILESTONES];
    const rows = feeds[feedIndex];
    feedIndex += 1;
    complete({ data: rows.map((row) => ({ ...row })) });
  });
});

test("loads, combines, sorts, and formats the current timeline feeds", async () => {
  const { container, findByText, getByText, queryByText } = renderApp();

  expect(getByText("The Baller Express")).toBeInTheDocument();
  await findByText("Group trip");

  expect(Papa.parse).toHaveBeenCalledTimes(2);
  const [masterCall, submittedCall] = Papa.parse.mock.calls;
  expect(masterCall[0]).not.toBe(submittedCall[0]);
  for (const [url, options] of Papa.parse.mock.calls) {
    expect(url).toMatch(/^https:\/\/docs\.google\.com\/spreadsheets\/.+output=csv$/);
    expect(options).toEqual(
      expect.objectContaining({
        download: true,
        header: true,
        complete: expect.any(Function),
      }),
    );
  }
  expect(queryByText("Hidden spam")).not.toBeInTheDocument();

  const descriptions = Array.from(
    container.querySelectorAll(".item .event span"),
  ).map((event) => event.textContent);
  expect(descriptions).toEqual([
    "Group trip",
    "Bob moved",
    "Alice and Bob met",
  ]);

  const approximateItem = getByText("Bob moved").closest(".item");
  expect(within(approximateItem).getByText("February")).toBeInTheDocument();
  expect(within(approximateItem).queryByText("February 3")).toBeNull();
});

test("filters loaded milestones by type", async () => {
  const { container, findByText, getByText } = renderApp();
  const tripItem = (await findByText("Group trip")).closest(".item");

  fireEvent.click(container.querySelector(".btn--orange"));
  const filterModal = getByText("Filter the timeline").closest(".modal-wrap");
  const tripFilter = within(filterModal).getByLabelText("trip");

  fireEvent.click(tripFilter);
  expect(tripItem).toHaveClass("hide");
  fireEvent.click(tripFilter);
  expect(tripItem).not.toHaveClass("hide");
});

test("switches people filters from any selected person to all selected people", async () => {
  const { container, findByText, getByText } = renderApp();
  const tripItem = (await findByText("Group trip")).closest(".item");
  const moveItem = getByText("Bob moved").closest(".item");
  const introItem = getByText("Alice and Bob met").closest(".item");

  fireEvent.click(container.querySelector(".btn--orange"));
  const peopleBlock = container.querySelector(".filter-block--people");
  fireEvent.click(within(peopleBlock).getByText("Uncheck all"));
  fireEvent.click(within(peopleBlock).getByLabelText("Alice"));
  fireEvent.click(within(peopleBlock).getByLabelText("Bob"));

  expect(tripItem).not.toHaveClass("hide");
  expect(moveItem).not.toHaveClass("hide");
  expect(introItem).not.toHaveClass("hide");

  fireEvent.click(peopleBlock.querySelector(".exclusive-wrapper input"));
  expect(tripItem).toHaveClass("hide");
  expect(moveItem).toHaveClass("hide");
  expect(introItem).not.toHaveClass("hide");
});

test("submission forms are absent until opened and are removed on close", async () => {
  const { container, findByText, getByLabelText, queryByText } = renderApp();
  await findByText("Group trip");

  expect(container.querySelector("form")).toBeNull();
  expect(container.querySelector("iframe")).toBeNull();
  expect(container.innerHTML).not.toContain("docs.google.com/forms");

  fireEvent.click(getByLabelText("Add a milestone"));
  expect(queryByText("Add a milestone", { selector: "h2" })).toBeInTheDocument();
  expect(container.querySelector("form")).not.toHaveAttribute("action");

  fireEvent.click(getByLabelText("Close add milestone form"));
  expect(container.querySelector("form")).toBeNull();
});

test("only ID-bearing milestones can open a secure edit proposal", async () => {
  const { findByText, getByLabelText, getByRole } = renderApp();
  await findByText("Group trip");

  expect(
    getByLabelText("Editing Bob moved is unavailable until migration"),
  ).toBeDisabled();

  fireEvent.click(getByLabelText("Propose an edit to Alice and Bob met"));
  const dialog = getByRole("dialog");
  expect(within(dialog).getByText("01/02/2020")).toBeInTheDocument();
  expect(within(dialog).getByText("Alice and Bob met")).toBeInTheDocument();
  expect(within(dialog).getByText("Alice, Bob")).toBeInTheDocument();
});

test("sends an exact milestone payload and inserts the returned public event", async () => {
  const acceptedEvent = {
    event_id: "event-new-1",
    date: "2026-11-17",
    precise: "Y",
    event: "Dana joined the picnic",
    people: "Alice, Dana",
    type: "event",
    size: "m",
  };
  const api = defaultApi({
    submitMilestone: jest.fn().mockResolvedValue({
      ok: true,
      submissionId: "submission-new-1",
      event: acceptedEvent,
    }),
  });
  const { findByText, getByLabelText, getByRole, queryByRole } = renderApp(api);
  await findByText("Group trip");
  fireEvent.click(getByLabelText("Add a milestone"));

  const dialog = getByRole("dialog");
  fireEvent.click(within(dialog).getByLabelText("event"));
  fireEvent.change(within(dialog).getByLabelText("When did it happen?"), {
    target: { value: "2026-11-17" },
  });
  fireEvent.change(within(dialog).getByLabelText("What happened?"), {
    target: { value: "Dana joined the picnic" },
  });
  fireEvent.click(within(dialog).getByLabelText("Alice"));
  fireEvent.change(within(dialog).getByLabelText("Anyone else?"), {
    target: { value: "Dana" },
  });
  fireEvent.change(within(dialog).getByLabelText("Your name"), {
    target: { value: "  Test Contributor  " },
  });
  fireEvent.change(within(dialog).getByLabelText("Your email"), {
    target: { value: "test@example.invalid" },
  });
  fireEvent.click(within(dialog).getByText("Submit milestone"));

  await wait(() => expect(api.submitMilestone).toHaveBeenCalledTimes(1));
  expect(api.submitMilestone).toHaveBeenCalledWith({
    requestId: expect.stringMatching(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    ),
    turnstileToken: "test-token-add_milestone",
    type: "event",
    date: "2026-11-17",
    approximate: false,
    description: "Dana joined the picnic",
    people: ["Alice", "Dana"],
    contributorName: "Test Contributor",
    contributorEmail: "test@example.invalid",
  });

  expect(await findByText("Dana joined the picnic")).toBeInTheDocument();
  expect(await findByText("November 17")).toBeInTheDocument();
  expect(
    await findByText(
      "What a milestone! It’s officially been immortalized on the timeline.",
    ),
  ).toBeInTheDocument();

  const noticeRegion = getByRole("status").closest(
    ".submission-notice-region",
  );
  fireEvent.click(getByLabelText("Dismiss submission message"));
  expect(noticeRegion).toHaveClass("submission-notice-region--exiting");
  expect(getByRole("status")).toBeInTheDocument();
  fireEvent.animationEnd(noticeRegion);
  expect(queryByRole("status")).toBeNull();
});

test("keeps a request ID for an unchanged retry and replaces it after edits", async () => {
  const retryError = new SubmissionError(
    "network_error",
    "The submission could not reach staging. Check your connection and try again.",
    { retryable: true },
  );
  const api = defaultApi({
    submitMilestone: jest
      .fn()
      .mockRejectedValueOnce(retryError)
      .mockRejectedValueOnce(retryError)
      .mockResolvedValueOnce({
        ok: true,
        submissionId: "submission-retry",
        event: {
          event_id: "event-retry",
          date: "2026-11-17",
          precise: "Y",
          event: "Changed description",
          people: "Alice",
          type: "trip",
          size: "m",
        },
      }),
  });
  const { findByText, getByLabelText, getByRole } = renderApp(api);
  await findByText("Group trip");
  fireEvent.click(getByLabelText("Add a milestone"));
  const dialog = getByRole("dialog");
  fireEvent.click(within(dialog).getByLabelText("trip"));
  fireEvent.change(within(dialog).getByLabelText("When did it happen?"), {
    target: { value: "2026-11-17" },
  });
  const description = within(dialog).getByLabelText("What happened?");
  fireEvent.change(description, { target: { value: "First description" } });
  fireEvent.click(within(dialog).getByLabelText("Alice"));

  fireEvent.click(within(dialog).getByText("Submit milestone"));
  await wait(() => expect(api.submitMilestone).toHaveBeenCalledTimes(1));
  fireEvent.click(within(dialog).getByText("Submit milestone"));
  await wait(() => expect(api.submitMilestone).toHaveBeenCalledTimes(2));

  const firstId = api.submitMilestone.mock.calls[0][0].requestId;
  const secondId = api.submitMilestone.mock.calls[1][0].requestId;
  expect(secondId).toBe(firstId);

  fireEvent.change(description, { target: { value: "Changed description" } });
  fireEvent.click(within(dialog).getByText("Submit milestone"));
  await wait(() => expect(api.submitMilestone).toHaveBeenCalledTimes(3));
  expect(api.submitMilestone.mock.calls[2][0].requestId).not.toBe(firstId);
});

test("sends an edit proposal privately without changing the timeline", async () => {
  const api = defaultApi({
    submitEditProposal: jest.fn().mockResolvedValue({
      ok: true,
      submissionId: "submission-edit-1",
    }),
  });
  const { container, findByText, getByLabelText, getByRole } = renderApp(api);
  await findByText("Group trip");
  const before = Array.from(
    container.querySelectorAll(".item .event span"),
  ).map((node) => node.textContent);

  fireEvent.click(getByLabelText("Propose an edit to Alice and Bob met"));
  const dialog = getByRole("dialog");
  fireEvent.click(within(dialog).getByText("The date of the milestone:"));
  fireEvent.click(within(dialog).getByText("The description:"));
  fireEvent.change(within(dialog).getByLabelText("What should be updated?"), {
    target: { value: "Move it one day and add the picnic location." },
  });
  fireEvent.click(within(dialog).getByText("Submit edit proposal"));

  await wait(() => expect(api.submitEditProposal).toHaveBeenCalledTimes(1));
  expect(api.submitEditProposal).toHaveBeenCalledWith({
    requestId: expect.any(String),
    turnstileToken: "test-token-edit_proposal",
    original: {
      eventId: "event-existing-1",
      date: "2020-01-02",
      description: "Alice and Bob met",
      people: ["Alice", "Bob"],
    },
    fields: ["date", "description"],
    requestedChange: "Move it one day and add the picnic location.",
  });
  expect(
    await findByText(
      "Your edit has been sent to ABC for review. Thanks for keeping the timeline honest!",
    ),
  ).toBeInTheDocument();
  const after = Array.from(
    container.querySelectorAll(".item .event span"),
  ).map((node) => node.textContent);
  expect(after).toEqual(before);
});

test("shows the approved message for a duplicate milestone", async () => {
  const api = defaultApi({
    submitMilestone: jest.fn().mockRejectedValue(
      new SubmissionError(
        "duplicate_submission",
        "This submission was already received.",
      ),
    ),
  });
  const { findByText, getByLabelText, getByRole } = renderApp(api);
  await findByText("Group trip");
  fireEvent.click(getByLabelText("Add a milestone"));

  const dialog = getByRole("dialog");
  fireEvent.click(within(dialog).getByLabelText("event"));
  fireEvent.change(within(dialog).getByLabelText("When did it happen?"), {
    target: { value: "2026-11-17" },
  });
  fireEvent.change(within(dialog).getByLabelText("What happened?"), {
    target: { value: "A milestone already sent" },
  });
  fireEvent.click(within(dialog).getByLabelText("Alice"));
  fireEvent.click(within(dialog).getByText("Submit milestone"));

  expect(
    await findByText(
      "That milestone was already received. No duplicate was added.",
    ),
  ).toBeInTheDocument();
});

test("shows the approved message for a duplicate edit proposal", async () => {
  const api = defaultApi({
    submitEditProposal: jest.fn().mockRejectedValue(
      new SubmissionError(
        "duplicate_submission",
        "This submission was already received.",
      ),
    ),
  });
  const { findByText, getByLabelText, getByRole } = renderApp(api);
  await findByText("Group trip");
  fireEvent.click(getByLabelText("Propose an edit to Alice and Bob met"));

  const dialog = getByRole("dialog");
  fireEvent.click(within(dialog).getByText("The description:"));
  fireEvent.change(within(dialog).getByLabelText("What should be updated?"), {
    target: { value: "This edit proposal was already sent." },
  });
  fireEvent.click(within(dialog).getByText("Submit edit proposal"));

  expect(
    await findByText(
      "That edit proposal was already received. No duplicate was added.",
    ),
  ).toBeInTheDocument();
});
