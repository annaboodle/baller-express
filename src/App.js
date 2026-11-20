import React, { useEffect, useRef, useState } from "react";
import Papa from "papaparse";
import { loadPublishedTimeline } from "./publishedTimeline";
import uid from "uid";
import stickybits from "stickybits";

import AddCommentIcon from "./components/icons/AddCommentIcon.js";
import FilterIcon from "./components/icons/FilterIcon.js";
import AddIcon from "./components/icons/AddIcon.js";
import AddPhotoIcon from "./components/icons/AddPhotoIcon.js";

import FilterModal from "./components/FilterModal";
import Loader from "./components/Loader";
import SubmissionModal from "./components/SubmissionModal";
import AddMilestoneForm from "./components/AddMilestoneForm.js";
import SubmitEditForm from "./components/SubmitEditForm.js";

import { randomAvatarColors } from "./utils";
import { photoMap } from "./photoMap";
import {
  createSubmissionApi,
  dateSortKey,
  formatTimelineDate,
  getSubmissionConfig,
  parsePeople,
} from "./submissions";

import "./styles/index.scss";

const MASTER_SHEET =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSQVovaTHIAN1669rUYinPqb3VfZIGBvpgiqKkNNW44Zkl2ZHhx-MdVCsD6CHDVUnmcc__UDNR5LBrt/pub?output=csv";
const SUBMITTED_MILESTONES =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQYc1XgbSvLbZZwd-ta4Nm0hJ3K75-FpOIBkk8n01mUDZXiXw3cAeZ91i5heLWKowOjnSEk9PZioAb8/pub?output=csv";

function initialFilterTypes() {
  return ["event", "intro", "move", "trip"].map((type) => ({
    type,
    checked: true,
    uid: uid(),
  }));
}

function sortTimeline(rows) {
  return [...rows].sort((a, b) =>
    dateSortKey(a.date) < dateSortKey(b.date) ? 1 : -1,
  );
}

function personOptions(rows, checked) {
  const names = [];
  rows.forEach(({ people }) => {
    parsePeople(people).forEach((person) => {
      if (!names.includes(person)) names.push(person);
    });
  });
  return names
    .sort((a, b) => (a > b ? 1 : -1))
    .map((person) => ({ person, checked, uid: uid() }));
}

function App({ submissionConfig: suppliedConfig, submissionApi: suppliedApi }) {
  const stage3EditPreviewEnabled =
    process.env.NODE_ENV === "development" &&
    new URLSearchParams(window.location.search).get("stage3EditPreview") === "1";
  const [submissionConfig] = useState(
    () => suppliedConfig || getSubmissionConfig(),
  );
  const [submissionApi] = useState(
    () => suppliedApi || createSubmissionApi(submissionConfig),
  );
  const [data, updateData] = useState([]);

  const [filterTypes, updateFilterTypes] = useState(initialFilterTypes);
  const [filterPeople, updateFilterPeople] = useState([]);
  const [isFilterPeopleExclusive, updateIsFilterPeopleExclusive] =
    useState(true);

  const [filterModalOpen, updateFilterModal] = useState(false);
  const [editModalOpen, updateEditModalOpen] = useState(false);
  const [addModalOpen, updateAddModalOpen] = useState(false);
  const [selectedEditMilestone, setSelectedEditMilestone] = useState(null);
  const [addBusy, setAddBusy] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [submissionNotice, setSubmissionNotice] = useState("");
  const [submissionNoticeExiting, setSubmissionNoticeExiting] =
    useState(false);

  const [addEventType, updateAddEventType] = useState("");
  const [addEventDate, updateAddEventDate] = useState("");
  const [addEventPrecise, updateAddEventPrecise] = useState(false);
  const [addEventDesc, updateAddEventDesc] = useState("");
  const [addEventCheckboxesData, updateAddEventCheckboxesData] = useState([]);
  const [addEventOtherPeople, updateAddEventOtherPeople] = useState("");

  const addButtonRef = useRef(null);

  useEffect(() => {
    const header = stickybits(".header", { stickyBitStickyOffset: 0 });
    return () => header?.cleanup?.();
  }, []);

  useEffect(() => {
    if (data.length === 0) return undefined;
    const years = stickybits(".year-wrap", {
      useStickyClasses: true,
      stickyBitStickyOffset: 70,
    });
    return () => years?.cleanup?.();
  }, [data.length]);

  useEffect(() => {
    let active = true;
    function display(rows) {
      if (!active) return;
      const timeline = sortTimeline(rows.filter((row) => row && row.date && row.event));
      updateData(timeline);
      updateFilterPeople(personOptions(timeline, true));
      updateAddEventCheckboxesData(personOptions(timeline, false));
    }

    if (process.env.NODE_ENV === "production") {
      loadPublishedTimeline(process.env.REACT_APP_PRODUCTION_TIMELINE_CSV, display);
    } else {
      Papa.parse(MASTER_SHEET, {
        download: true,
        header: true,
        complete(master) {
          if (!active) return;
          Papa.parse(SUBMITTED_MILESTONES, {
            download: true,
            header: true,
            complete(submissions) {
              display(master.data.concat(submissions.data.filter((row) => row.hide !== "Y")));
            },
          });
        },
      });
    }
    return () => { active = false; };
  }, []);

  const peopleToShow = filterPeople
    .filter((filter) => filter.checked)
    .map((filter) => filter.person);
  const typesToHide = filterTypes
    .filter((filter) => !filter.checked)
    .map((filter) => filter.type);

  let currentYear = "";
  const timelineItems = data.map((milestone, index) => {
    const { event, precise, date, type, size, people, event_id: eventId } =
      milestone;
    const editableEventId =
      eventId ||
      (stage3EditPreviewEnabled ? `stage3-layout-preview-${index}` : "");
    const peopleInThisEvent = parsePeople(people);
    const peopleInFiltersAndThisEvent = peopleInThisEvent.filter((person) =>
      peopleToShow.includes(person),
    );
    const allPeopleInFiltersAreInThisEvent = peopleToShow.every((person) =>
      peopleInThisEvent.includes(person),
    );
    const peopleNotInFilter = peopleInFiltersAndThisEvent.length < 1;
    const typeNotInFilter = typesToHide.includes(type);
    const hideThisItem = isFilterPeopleExclusive
      ? peopleNotInFilter || typeNotInFilter
      : !allPeopleInFiltersAreInThisEvent || typeNotInFilter;
    const formattedDate = formatTimelineDate(date, precise);
    const showYear =
      !hideThisItem && formattedDate.year && formattedDate.year !== currentYear;
    if (showYear) currentYear = formattedDate.year;

    const peopleAvatars = peopleInThisEvent.map((person, personIndex) => {
      const photoUrl = photoMap[person];
      return (
        <div
          key={person}
          style={{
            backgroundImage: `url(${photoUrl})`,
            backgroundColor:
              randomAvatarColors[
                (index + personIndex) % randomAvatarColors.length
              ],
          }}
          className="person"
        >
          {photoUrl === undefined && person.charAt(0)}
          <div className="person-label">{person}</div>
        </div>
      );
    });

    return (
      <React.Fragment key={eventId || `${date}-${event}-${index}`}>
        {showYear && (
          <div className="year-wrap" id={formattedDate.year}>
            <div className="year">{formattedDate.year}</div>
          </div>
        )}
        <div
          className={`item type--${type} size--${size || "m"} ${
            hideThisItem ? "hide" : ""
          }`}
        >
          <div className="item-inner">
            <div className="date">{formattedDate.label}</div>
            <div className="item-content">
              <div className="event">
                <span>{event}</span>
              </div>
              <div className="people-wrap">{peopleAvatars}</div>
            </div>
          </div>

          <div className="edit-btn-wrap">
            <button
              type="button"
              className={`btn btn--blue ${
                editableEventId ? "" : "btn--disabled"
              }`}
              disabled={!editableEventId}
              title={
                editableEventId
                  ? "Propose an edit"
                  : "Editing becomes available after the timeline migration"
              }
              aria-label={
                editableEventId
                  ? `Propose an edit to ${event}`
                  : `Editing ${event} is unavailable until migration`
              }
              onClick={() => {
                setSelectedEditMilestone(
                  eventId
                    ? milestone
                    : { ...milestone, event_id: editableEventId },
                );
                updateEditModalOpen(true);
              }}
            >
              <AddCommentIcon fill="#00ade06b" />
            </button>
          </div>
        </div>
      </React.Fragment>
    );
  });

  const addEventCheckboxes = addEventCheckboxesData.map((checkData, index) => (
    <div key={checkData.uid} className="form-field form-field--checkbox">
      <label className="checkbox-container">
        {checkData.person}
        <input
          type="checkbox"
          onChange={() => {
            updateAddEventCheckboxesData((oldOptions) =>
              oldOptions.map((option, optionIndex) =>
                optionIndex === index
                  ? { ...option, checked: !option.checked }
                  : option,
              ),
            );
          }}
          checked={checkData.checked}
        />
        <span className="checkmark" />
      </label>
    </div>
  ));

  function resetAddFields() {
    updateAddEventType("");
    updateAddEventCheckboxesData((options) =>
      options.map((option) => ({ ...option, checked: false })),
    );
    updateAddEventDate("");
    updateAddEventDesc("");
    updateAddEventPrecise(false);
    updateAddEventOtherPeople("");
  }

  function closeAddModal() {
    if (addBusy) return;
    resetAddFields();
    updateAddModalOpen(false);
  }

  function closeEditModal() {
    if (editBusy) return;
    updateEditModalOpen(false);
    setSelectedEditMilestone(null);
  }

  function ensurePeopleAreAvailable(people) {
    const names = parsePeople(people);
    updateFilterPeople((options) => {
      const existing = new Set(options.map((option) => option.person));
      return options
        .concat(
          names
            .filter((person) => !existing.has(person))
            .map((person) => ({ person, checked: true, uid: uid() })),
        )
        .sort((a, b) => (a.person > b.person ? 1 : -1));
    });
    updateAddEventCheckboxesData((options) => {
      const existing = new Set(options.map((option) => option.person));
      return options
        .concat(
          names
            .filter((person) => !existing.has(person))
            .map((person) => ({ person, checked: false, uid: uid() })),
        )
        .sort((a, b) => (a.person > b.person ? 1 : -1));
    });
  }

  function acceptMilestone(result) {
    const acceptedEvent = result.event;
    updateData((rows) =>
      sortTimeline([
        acceptedEvent,
        ...rows.filter((row) => row.event_id !== acceptedEvent.event_id),
      ]),
    );
    ensurePeopleAreAvailable(acceptedEvent.people);
    setSubmissionNoticeExiting(false);
    setSubmissionNotice(
      "What a milestone! It’s officially been immortalized on the timeline.",
    );
    setAddBusy(false);
    resetAddFields();
    updateAddModalOpen(false);
  }

  function acceptEditProposal() {
    setSubmissionNoticeExiting(false);
    setSubmissionNotice(
      "Your edit has been sent to ABC for review. Thanks for keeping the timeline honest!",
    );
    setEditBusy(false);
    updateEditModalOpen(false);
    setSelectedEditMilestone(null);
  }

  function closeDuplicate(kind) {
    setSubmissionNoticeExiting(false);
    setSubmissionNotice(
      kind === "milestone"
        ? "That milestone was already received. No duplicate was added."
        : "That edit proposal was already received. No duplicate was added.",
    );
    if (kind === "milestone") {
      setAddBusy(false);
      resetAddFields();
      updateAddModalOpen(false);
    } else {
      setEditBusy(false);
      updateEditModalOpen(false);
      setSelectedEditMilestone(null);
    }
  }

  return (
    <div className="App">
      <div className="timeline">
        <div className="header">
          <div className="title-wrapper">
            <span className="logo-emoji" role="img" aria-label="Train emoji">
              🚂
            </span>
            <h1 className="title">The Baller Express</h1>
          </div>
          <div className="btn-wrap">
            <button
              type="button"
              className="btn btn--orange"
              aria-label="Filter the timeline"
              onClick={() => updateFilterModal(true)}
            >
              <FilterIcon />
            </button>
            <a
              href="https://photos.app.goo.gl/dEVzY9gZQb4pjsfM9"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn--green"
              aria-label="Add photos"
            >
              <AddPhotoIcon />
            </a>
            <button
              ref={addButtonRef}
              type="button"
              className="btn btn--blue"
              aria-label="Add a milestone"
              onClick={() => updateAddModalOpen(true)}
            >
              <AddIcon />
            </button>
          </div>
        </div>

        {submissionNotice && (
          <div
            className={`submission-notice-region${
              submissionNoticeExiting
                ? " submission-notice-region--exiting"
                : ""
            }`}
            onAnimationEnd={() => {
              if (!submissionNoticeExiting) return;
              setSubmissionNotice("");
              setSubmissionNoticeExiting(false);
            }}
          >
            <div className="submission-notice-clip">
              <div className="submission-notice" role="status">
                <span>{submissionNotice}</span>
                <button
                  type="button"
                  aria-label="Dismiss submission message"
                  onClick={() => setSubmissionNoticeExiting(true)}
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        )}

        {data.length === 0 ? <Loader /> : timelineItems}
      </div>

      <div className="footer">
        Made by ABC for an amazing group of buddies{" "}
        <span role="img" aria-label="Heart emoji">
          💜
        </span>
      </div>

      <SubmissionModal
        open={addModalOpen}
        onClose={closeAddModal}
        busy={addBusy}
        titleId="add-milestone-title"
        className="modal--add"
        wrapperClassName="modal__add-event"
        closeLabel="Close add milestone form"
        returnFocusRef={addButtonRef}
      >
        <AddMilestoneForm
          submissionConfig={submissionConfig}
          submissionApi={submissionApi}
          onAccepted={acceptMilestone}
          onDuplicate={() => closeDuplicate("milestone")}
          onBusyChange={setAddBusy}
          addEventType={addEventType}
          updateAddEventType={updateAddEventType}
          addEventDate={addEventDate}
          updateAddEventDate={updateAddEventDate}
          addEventPrecise={addEventPrecise}
          updateAddEventPrecise={updateAddEventPrecise}
          addEventDesc={addEventDesc}
          updateAddEventDesc={updateAddEventDesc}
          addEventCheckboxes={addEventCheckboxes}
          selectedPeople={addEventCheckboxesData
            .filter((option) => option.checked)
            .map((option) => option.person)}
          addEventOtherPeople={addEventOtherPeople}
          updateAddEventOtherPeople={updateAddEventOtherPeople}
        />
      </SubmissionModal>

      <SubmissionModal
        open={editModalOpen && Boolean(selectedEditMilestone)}
        onClose={closeEditModal}
        busy={editBusy}
        titleId="edit-milestone-title"
        className="modal--edit"
        wrapperClassName="modal__edit-event"
        closeLabel="Close edit proposal form"
      >
        {selectedEditMilestone && (
          <SubmitEditForm
            submissionConfig={submissionConfig}
            submissionApi={submissionApi}
            milestone={selectedEditMilestone}
            onAccepted={acceptEditProposal}
            onDuplicate={() => closeDuplicate("edit")}
            onBusyChange={setEditBusy}
          />
        )}
      </SubmissionModal>

      <FilterModal
        filterModalOpen={filterModalOpen}
        updateFilterModal={updateFilterModal}
        filterTypes={filterTypes}
        updateFilterTypes={updateFilterTypes}
        filterPeople={filterPeople}
        updateFilterPeople={updateFilterPeople}
        isFilterPeopleExclusive={isFilterPeopleExclusive}
        updateIsFilterPeopleExclusive={updateIsFilterPeopleExclusive}
      />
    </div>
  );
}

export default App;
