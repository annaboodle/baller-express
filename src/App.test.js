import React from "react";
import { fireEvent, render, within } from "@testing-library/react";
import Papa from "papaparse";
import App from "./App";

jest.mock("papaparse", () => ({
  parse: jest.fn(),
}));

jest.mock("stickybits", () => jest.fn());

const MASTER_TIMELINE = [
  {
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

beforeEach(() => {
  jest.clearAllMocks();
  let feedIndex = 0;

  Papa.parse.mockImplementation((_url, { complete }) => {
    const feeds = [MASTER_TIMELINE, SUBMITTED_MILESTONES];
    const data = feeds[feedIndex];
    feedIndex += 1;

    complete({ data: data.map((row) => ({ ...row })) });
  });
});

test("loads, combines, sorts, and formats the current timeline feeds", async () => {
  const { container, findByText, getByText, queryByText } = render(<App />);

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

  const eventDescriptions = Array.from(
    container.querySelectorAll(".item .event span")
  ).map((event) => event.textContent);

  expect(eventDescriptions).toEqual([
    "Group trip",
    "Bob moved",
    "Alice and Bob met",
  ]);

  const approximateDateItem = getByText("Bob moved").closest(".item");
  expect(within(approximateDateItem).getByText("February")).toBeInTheDocument();
  expect(within(approximateDateItem).queryByText("February 3")).toBeNull();
});

test("filters loaded milestones by type", async () => {
  const { container, findByText, getByText } = render(<App />);
  const tripDescription = await findByText("Group trip");
  const tripItem = tripDescription.closest(".item");

  fireEvent.click(container.querySelector(".btn--orange"));

  const filterModal = getByText("Filter the timeline").closest(".modal-wrap");
  const tripFilter = within(filterModal).getByLabelText("trip");

  expect(filterModal).toHaveClass("modal-open");

  fireEvent.click(tripFilter);
  expect(tripItem).toHaveClass("hide");

  fireEvent.click(tripFilter);
  expect(tripItem).not.toHaveClass("hide");
});

test("switches people filters from any selected person to all selected people", async () => {
  const { container, findByText, getByText } = render(<App />);
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

test("opens the selected milestone for editing with its reference data", async () => {
  const { container, findByText } = render(<App />);
  const description = await findByText("Alice and Bob met");
  const timelineItem = description.closest(".item");
  const editModal = container.querySelector(".modal__edit-event");

  expect(editModal).not.toHaveClass("modal-open");

  fireEvent.click(timelineItem.querySelector(".edit-btn-wrap .btn"));

  expect(editModal).toHaveClass("modal-open");
  expect(within(editModal).getByText("01/02/2020")).toBeInTheDocument();
  expect(within(editModal).getByText("Alice and Bob met")).toBeInTheDocument();
  expect(within(editModal).getByText("Alice, Bob")).toBeInTheDocument();
});
