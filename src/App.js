import React, { useState, useEffect } from "react";
import Papa from "papaparse";
import uid from "uid";
import stickybits from "stickybits";

import AddCommentIcon from "./components/icons/AddCommentIcon.js";
import FilterIcon from "./components/icons/FilterIcon.js";
import AddIcon from "./components/icons/AddIcon.js";
import AddPhotoIcon from "./components/icons/AddPhotoIcon.js";
import CloseIcon from "./components/icons/CloseIcon.js";

import FilterModal from "./components/FilterModal";
import Loader from "./components/Loader";

import AddMilestoneForm from "./components/AddMilestoneForm.js";
import SubmitEditForm from "./components/SubmitEditForm.js";

import { randomAvatarColors, monthNames } from "./utils";
import { photoMap } from "./photoMap";

import "./styles/index.scss";

function App() {
  // DATA RETURNED FROM SPREADSHEETS:
  const [data, updateData] = useState([]);

  // FILTER SELECTIONS
  const [filterTypes, updateFilterTypes] = useState([
    {
      type: "event",
      checked: true,
      uid: uid(),
    },
    {
      type: "intro",
      checked: true,
      uid: uid(),
    },
    {
      type: "move",
      checked: true,
      uid: uid(),
    },
    {
      type: "trip",
      checked: true,
      uid: uid(),
    },
  ]);
  const [filterPeople, updateFilterPeople] = useState([]);
  const [isFilterPeopleExclusive, updateIsFilterPeopleExclusive] =
    useState(true);

  const [milestoneDescToSubmit, updateMilestoneDescToSubmit] = useState("");
  const [milestoneDateToSubmit, updateMilestoneDateToSubmit] = useState("");
  const [milestonePeopleToSubmit, updateMilestonePeopleToSubmit] = useState("");

  // MODAL CONTROLS:
  const [filterModalOpen, updateFilterModal] = useState(false);
  const [editModalOpen, updateEditModalOpen] = useState(false);
  const [addModalOpen, updateAddModalOpen] = useState(false);

  // FIELDS FOR 'EDIT MILESTONE' FORM
  const [editEventDesc, updateEditEventDesc] = useState("");
  const [peopleCheck, updatePeopleCheck] = useState(false);
  const [dateCheck, updateDateCheck] = useState(false);
  const [descCheck, updateDescCheck] = useState(false);

  // FIELDS FOR 'ADD A MILESTONE' FORM
  const [addEventType, updateAddEventType] = useState("");
  const [addEventDate, updateAddEventDate] = useState(""); // when did it happen?
  const [addEventPrecise, updateAddEventPrecise] = useState(false); // "this date isn't exact" checkbox
  const [addEventDesc, updateAddEventDesc] = useState("");
  const [addEventCheckboxesData, updateAddEventCheckboxesData] = useState([]); // an array of objects representing checkboxes of people
  const [addEventOtherPeople, updateAddEventOtherPeople] = useState(""); // "Anyone else?"

  // stick the header
  stickybits(".header", { stickyBitStickyOffset: 0 });

  // stick the years on scroll
  stickybits(".year-wrap", {
    useStickyClasses: true,
    stickyBitStickyOffset: 70,
  });

  // runs once on page load:
  useEffect(() => {
    function createFilters(data) {
      let allPeopleInEvents = [];

      let personFilters = [];

      let addEventPersonCheckboxes = [];

      data.forEach(({ people }) => {
        let peopleInThisEvent = formatPeople(people);
        peopleInThisEvent.forEach((person) => {
          if (allPeopleInEvents.indexOf(person) === -1) {
            allPeopleInEvents.push(person);
            let filter = {
              person,
              checked: true,
              uid: uid(),
            };
            personFilters.push(filter);

            let addEventPersonCheckbox = {
              person,
              checked: false,
              uid: uid(),
            };
            addEventPersonCheckboxes.push(addEventPersonCheckbox);
          }
        });
      });
      personFilters.sort((a, b) => (a.person > b.person ? 1 : -1)); // alphabetize
      updateFilterPeople(personFilters);

      addEventPersonCheckboxes.sort((a, b) => (a.person > b.person ? 1 : -1)); // alphabetize
      updateAddEventCheckboxesData(addEventPersonCheckboxes);
    }

    function formatDateForSort(googleDate) {
      const splitString = googleDate.split("/");
      let month = parseInt(splitString[0], 10);
      if (month < 10) {
        month = "0" + month;
      }
      let day = parseInt(splitString[1], 10);
      if (day < 10) {
        day = "0" + day;
      }
      const year = splitString[2];
      let formattedDate = `${year}-${month}-${day}`;
      return [formattedDate];
    }

    /* FOLLOWING CODE IS FOR PAPAPARSE */
    const MASTER_SHEET =
      "https://docs.google.com/spreadsheets/d/e/2PACX-1vSQVovaTHIAN1669rUYinPqb3VfZIGBvpgiqKkNNW44Zkl2ZHhx-MdVCsD6CHDVUnmcc__UDNR5LBrt/pub?output=csv";

    const SUBMITTED_MILESTONES =
      "https://docs.google.com/spreadsheets/d/e/2PACX-1vQYc1XgbSvLbZZwd-ta4Nm0hJ3K75-FpOIBkk8n01mUDZXiXw3cAeZ91i5heLWKowOjnSEk9PZioAb8/pub?output=csv";

    let MASTER_SHEET_DATA = [];

    Papa.parse(MASTER_SHEET, {
      download: true,
      header: true,
      complete: saveAndGetSubmittedResponses,
    });

    function saveAndGetSubmittedResponses(masterSheetData) {
      MASTER_SHEET_DATA = masterSheetData.data;

      Papa.parse(SUBMITTED_MILESTONES, {
        download: true,
        header: true,
        complete: finishSetup,
      });
    }

    function finishSetup(submittedResponsesData) {
      const FILTERED_RESPONSES = submittedResponsesData.data.filter(
        (milestone) => {
          return milestone.hide !== "Y"; // filter out responses we want to hide
        }
      );
      let dataFromBothSheets = MASTER_SHEET_DATA.concat(FILTERED_RESPONSES);
      let sortedData = dataFromBothSheets.sort((a, b) =>
        formatDateForSort(a.date) < formatDateForSort(b.date) ? 1 : -1
      ); // sort by date
      updateData(sortedData);
      createFilters(sortedData);
    }
    /* END CODE FOR PAPAPARSE */

    /* FOLLOWING CODE IS FOR TABLETOP. WORKED UNTIL AUGUST 2021 - KEEPING AS BACKUP FOR PAPAPARSE  */
    // function finishSetup(mainTimeline, submittedResponses) {
    //   const FILTERED_RESPONSES = submittedResponses.filter((milestone) => {
    //     return milestone.hide !== "Y"; // filter out responses we want to hide
    //   });
    //   let dataFromBothSheets = mainTimeline.concat(FILTERED_RESPONSES);
    //   let sortedData = dataFromBothSheets.sort((a, b) =>
    //     formatDateForSort(a.date) < formatDateForSort(b.date) ? 1 : -1
    //   ); // sort by date, most recent first
    //   updateData(sortedData);
    //   createFilters(sortedData);
    // }

    //   const mainTimelineData =
    //     "https://docs.google.com/spreadsheets/d/1v96fpa9peEx2LLEnto3FeagSkWOmsCM8JlRKoa1HDpE/pubhtml";

    //   const submittedResponseData =
    //     "https://docs.google.com/spreadsheets/d/1DFao95ZdEZLDeHEX8LxY4FsRN5q4cqBDiGZYTKYDObc/pubhtml";

    //   let mainTimeline = [];

    //   const setup = () => {
    //     Tabletop.init({
    //       key: mainTimelineData,
    //       callback: function (data, tabletop) {
    //         mainTimeline = data;
    //         Tabletop.init({
    //           key: submittedResponseData,
    //           callback: (data) => {
    //             finishSetup(mainTimeline, data);
    //           },
    //           simpleSheet: true,
    //         });
    //       },
    //       simpleSheet: true,
    //     });
    //   };

    //   setup();
    /* END CODE FOR TABLETOP */
  }, []);

  function formatDate(dateString, precise) {
    const splitString = dateString.split("/");
    const month = monthNames[parseInt(splitString[0], 10) - 1];
    const day = parseInt(splitString[1], 10);
    const year = splitString[2];
    const formattedDate = `${month} ${precise !== "N" ? day : ""}`;
    return [formattedDate, year];
  }

  let peopleToShow = [];
  filterPeople.map((filter, i) => {
    if (filter.checked) {
      peopleToShow.push(`${filter.person}`);
    }
    return peopleToShow;
  });

  let typesToHide = [];
  filterTypes.map((filter, i) => {
    if (!filter.checked) {
      typesToHide.push(`${filter.type}`);
    }
    return typesToHide;
  });

  // take comma separated string and return array of people strings
  function formatPeople(people) {
    let peopleStringWithoutSpaces = people.split(", ").join(",");
    const peopleInEvent = peopleStringWithoutSpaces.split(",");
    return peopleInEvent;
  }

  let showYear = false;
  let currentYear = new Date().getFullYear() + 1;

  const timelineItems = data.map(
    ({ event, precise, date, type, size, people }, index) => {
      let peopleInThisEvent = formatPeople(people);
      // this will show EXCLUSIVE filtering (at least one filter must be present)
      // which means there must be AT LEAST one of peopleToShow in peopleInThisEvent
      let peopleInFiltersAndThisEvent = peopleInThisEvent.filter(
        (value) => -1 !== peopleToShow.indexOf(value)
      );

      // this will show INCLUSIVE filtering (all filters must be present)
      //   which means ALL peopleToShow must be in peopleInThisEvent
      let allPeopleInFiltersAreInThisEvent = peopleToShow.every((person) =>
        peopleInThisEvent.includes(person)
      );

      let peopleNotInFilter = peopleInFiltersAndThisEvent.length < 1;
      let typeNotInFilter = typesToHide.indexOf(type) !== -1;

      let hideThisItem = isFilterPeopleExclusive
        ? peopleNotInFilter || typeNotInFilter
        : !allPeopleInFiltersAreInThisEvent || typeNotInFilter;

      // don't show year UNLESS it hasn't been shown yet
      showYear = false;
      if (formatDate(date, precise)[1] < currentYear && !hideThisItem) {
        showYear = true;
        currentYear = formatDate(date, precise)[1];
      }

      // get the people pix
      let peopleAvatars = peopleInThisEvent.map((person, i) => {
        let photoUrl = photoMap[person];
        let showInitial = photoUrl === undefined;
        return (
          <div
            key={i}
            style={{
              backgroundImage: `url(${photoUrl})`,
              backgroundColor: `${
                randomAvatarColors[
                  Math.floor(Math.random() * randomAvatarColors.length)
                ]
              }`,
            }}
            className="person"
          >
            {showInitial && person.charAt(0)}
            <div className="person-label">{person}</div>
          </div>
        );
      });

      return (
        <>
          {showYear && (
            <div
              className="year-wrap"
              id={formatDate(date, precise)[1]}
              key={`${index}-year`}
            >
              <div className="year">{formatDate(date, precise)[1]}</div>
            </div>
          )}
          <div
            key={`${index}-item`}
            className={`item type--${type} size--${size || "m"}
          ${hideThisItem ? "hide" : ""} `}
          >
            <div className="item-inner">
              <div className="date">{formatDate(date, precise)[0]}</div>

              <div className="item-content">
                <div className="event">
                  <span>{event}</span>
                </div>

                <div className="people-wrap">{peopleAvatars}</div>
              </div>
            </div>

            <div className="edit-btn-wrap">
              <div
                className="btn btn--blue"
                onClick={() => {
                  updateEditModalOpen(true);
                  updateMilestoneDescToSubmit(event);
                  updateMilestoneDateToSubmit(date);
                  updateMilestonePeopleToSubmit(people);
                }}
              >
                <AddCommentIcon fill="#00ade06b" />
              </div>
            </div>
          </div>
        </>
      );
    }
  );

  const addEventCheckboxes = addEventCheckboxesData.map((checkData, i) => {
    return (
      <div key={checkData.uid} className="form-field form-field--checkbox">
        <label className="checkbox-container">
          {checkData.person}
          <input
            type="checkbox"
            onChange={() => {
              let newAddEventCheckboxesData = [...addEventCheckboxesData];
              newAddEventCheckboxesData[i].checked =
                !newAddEventCheckboxesData[i].checked;
              updateAddEventCheckboxesData(newAddEventCheckboxesData);
            }}
            checked={checkData.checked}
          />
          <span className="checkmark" />
        </label>
      </div>
    );
  });

  function updateAllAddEventCheckboxes(value) {
    let oldAddEventCheckboxesData = [...addEventCheckboxesData];
    let newAddEventCheckboxesData = [];
    oldAddEventCheckboxesData.forEach(({ person, uid }) => {
      let newPersonCheckbox = {
        person,
        checked: value,
        uid,
      };
      newAddEventCheckboxesData.push(newPersonCheckbox);
    });
    updateAddEventCheckboxesData(newAddEventCheckboxesData);
  }

  // HELPER FUNCTIONS FOR 'EDIT MILESTONE' FORM
  function clearEditFormFields() {
    updateEditEventDesc("");
    updatePeopleCheck(false);
    updateDateCheck(false);
    updateDescCheck(false);
  }

  function closeEditModal() {
    clearEditFormFields();
    updateEditModalOpen(false);
  }

  // HELPER FUNCTIONS FOR 'ADD A MILESTONE' FORM
  function clearAddFormFields() {
    updateAddEventType(""); // what type of milestone is it?
    updateAllAddEventCheckboxes(false); // who was involved?
    updateAddEventDate(""); // when did it happen?
    updateAddEventDesc(""); // what happened?
    updateAddEventPrecise(false); // "this date isn't exact" checkbox
    updateAddEventOtherPeople(""); // anyone else?
  }

  function closeAddModal() {
    clearAddFormFields();
    updateAddModalOpen(false);
  }

  // builds the string to submit to google form
  function createStringOfAllPeopleInAddEvent() {
    let arrayOfAllPeople = [];
    addEventCheckboxesData.forEach((checkbox, i) => {
      if (checkbox.checked) {
        arrayOfAllPeople.push(checkbox.person);
      }
    });
    if (addEventOtherPeople.length > 0) {
      arrayOfAllPeople.push(addEventOtherPeople);
    }
    let stringOfAllPeopleInEvent = arrayOfAllPeople.join(", ");
    return stringOfAllPeopleInEvent;
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
              className="btn btn--orange"
              onClick={() => {
                updateFilterModal(true);
              }}
            >
              <FilterIcon />
            </button>
            <a
              href="https://photos.app.goo.gl/dEVzY9gZQb4pjsfM9"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn--green"
            >
              <AddPhotoIcon />
            </a>
            <button
              className="btn btn--blue"
              onClick={() => {
                updateAddModalOpen(true);
              }}
            >
              <AddIcon />
            </button>
          </div>
        </div>
        {/* {timelineItems}   */}
        {data.length === 0 ? <Loader /> : timelineItems}
      </div>

      <div className="footer">
        Made by ABC for an amazing group of buddies{" "}
        <span role="img" aria-label="Heart emoji">
          💜
        </span>
      </div>

      <div
        className={`modal__edit-event modal-wrap ${
          editModalOpen ? "modal-open" : ""
        }`}
      >
        <div
          className="modal-bg"
          onClick={() => {
            closeEditModal();
          }}
        />
        <div className="modal modal--edit">
          <div
            className="modal-close"
            onClick={() => {
              closeEditModal();
            }}
          >
            <CloseIcon />
          </div>

          <script type="text/javascript">var submitted=false;</script>
          <iframe
            title="iframe to submit google forms"
            name="hidden_iframe"
            id="hidden_iframe"
            style={{ display: "none" }}
            onLoad={(submitted) => {
              if (submitted) {
                window.location = "#";
              }
            }}
          />

          <SubmitEditForm
            onSubmit={() =>
              updateEditModalOpen(false).then(clearEditFormFields())
            }
            milestoneDateToSubmit={milestoneDateToSubmit}
            dateCheck={dateCheck}
            updateDateCheck={updateDateCheck}
            milestonePeopleToSubmit={milestonePeopleToSubmit}
            peopleCheck={peopleCheck}
            updatePeopleCheck={updatePeopleCheck}
            milestoneDescToSubmit={milestoneDescToSubmit}
            descCheck={descCheck}
            updateDescCheck={updateDescCheck}
            editEventDesc={editEventDesc}
            updateEditEventDesc={updateEditEventDesc}
          ></SubmitEditForm>
        </div>
      </div>

      <div
        className={`modal__add-event modal-wrap ${
          addModalOpen ? "modal-open" : ""
        }`}
      >
        <div
          className="modal-bg"
          onClick={() => {
            closeAddModal();
          }}
        />
        <div className="modal modal--add">
          <div
            className="modal-close"
            onClick={() => {
              closeAddModal();
            }}
          >
            <CloseIcon />
          </div>
          <AddMilestoneForm
            onSubmit={() =>
              updateAddModalOpen(false).then(clearAddFormFields())
            }
            addEventType={addEventType}
            updateAddEventType={updateAddEventType}
            addEventDate={addEventDate}
            updateAddEventDate={updateAddEventDate}
            addEventPrecise={addEventPrecise}
            updateAddEventPrecise={updateAddEventPrecise}
            addEventDesc={addEventDesc}
            updateAddEventDesc={updateAddEventDesc}
            addEventCheckboxes={addEventCheckboxes}
            addEventOtherPeople={addEventOtherPeople}
            updateAddEventOtherPeople={updateAddEventOtherPeople}
            createStringOfAllPeopleInAddEvent={
              createStringOfAllPeopleInAddEvent
            }
          ></AddMilestoneForm>
        </div>
      </div>

      <FilterModal
        filterModalOpen={filterModalOpen}
        updateFilterModal={updateFilterModal}
        filterTypes={filterTypes}
        updateFilterTypes={updateFilterTypes}
        filterPeople={filterPeople}
        updateFilterPeople={updateFilterPeople}
        isFilterPeopleExclusive={isFilterPeopleExclusive}
        updateIsFilterPeopleExclusive={updateIsFilterPeopleExclusive}
      ></FilterModal>
    </div>
  );
}

export default App;
